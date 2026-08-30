/* ESCAPE — グリッドマップからのプレースホルダ描画
 * P1は「方向がわかる程度」の無地＋面ごとの色分け＋床グリッド線まで。
 * 質感（プロシージャルテクスチャ）と照明は P2 の領分なので、ここでは光源を使わない
 * MeshBasicMaterial ＋ フォグのみで構成する。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  var COLOR = {
    fog: 0x0b0d10,
    floorA: 0x252b32,
    floorB: 0x1d2228,
    grid: 0x4d5b68,
    ceil: 0x121417,
    faceXP: 0x5d6975, faceXN: 0x3c454f,
    faceZP: 0x515d69, faceZN: 0x333b45,
    faceTop: 0x6a7682, faceBottom: 0x272c33
  };

  function setBoxFaceColors(geo) {
    var c = new THREE.Color();
    var colors = new Float32Array(geo.attributes.position.count * 3);
    // BoxGeometry の面順: +X, -X, +Y, -Y, +Z, -Z（各4頂点）
    var order = [COLOR.faceXP, COLOR.faceXN, COLOR.faceTop, COLOR.faceBottom, COLOR.faceZP, COLOR.faceZN];
    for (var f = 0; f < 6; f++) {
      c.setHex(order[f]);
      for (var v = 0; v < 4; v++) {
        var i = (f * 4 + v) * 3;
        colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  function World(map) {
    this.map = map;
    this.group = new THREE.Group();
    this.disposables = [];
    this._build();
  }

  World.prototype._track = function (o) { this.disposables.push(o); return o; };

  World.prototype._build = function () {
    var map = this.map, T = map.tileSize, H = map.wallHeight;

    /* --- 床（歩行可能マスのみ・市松の淡い色分けで移動が分かるように） --- */
    var cells = map.walkableCells();
    var pos = new Float32Array(cells.length * 6 * 3);
    var col = new Float32Array(cells.length * 6 * 3);
    var cA = new THREE.Color(COLOR.floorA), cB = new THREE.Color(COLOR.floorB);
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var x0 = c.col * T, x1 = x0 + T, z0 = c.row * T, z1 = z0 + T;
      var quad = [
        x0, 0, z0, x0, 0, z1, x1, 0, z1,
        x0, 0, z0, x1, 0, z1, x1, 0, z0
      ];
      var cc = ((c.col + c.row) % 2 === 0) ? cA : cB;
      for (var v = 0; v < 6; v++) {
        var k = (i * 6 + v) * 3;
        pos[k] = quad[v * 3]; pos[k + 1] = quad[v * 3 + 1]; pos[k + 2] = quad[v * 3 + 2];
        col[k] = cc.r; col[k + 1] = cc.g; col[k + 2] = cc.b;
      }
    }
    var floorGeo = this._track(new THREE.BufferGeometry());
    floorGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    floorGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var floorMat = this._track(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.group.add(this.floor);

    /* --- 床のグリッド線（1マス=2mが目で分かるように） --- */
    var gl = [];
    for (var gx = 0; gx <= map.width; gx++) { gl.push(gx * T, 0.012, 0, gx * T, 0.012, map.height * T); }
    for (var gz = 0; gz <= map.height; gz++) { gl.push(0, 0.012, gz * T, map.width * T, 0.012, gz * T); }
    var gridGeo = this._track(new THREE.BufferGeometry());
    gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gl), 3));
    var gridMat = this._track(new THREE.LineBasicMaterial({ color: COLOR.grid, transparent: true, opacity: 0.45, fog: true }));
    this.grid = new THREE.LineSegments(gridGeo, gridMat);
    this.group.add(this.grid);

    /* --- 壁（歩ける場所に面している実体セルだけ立てる） --- */
    var wallCells = [];
    for (var r = 0; r < map.height; r++) {
      for (var cc2 = 0; cc2 < map.width; cc2++) {
        if (!map.isSolid(cc2, r)) continue;
        var exposed = false;
        for (var dr = -1; dr <= 1 && !exposed; dr++) {
          for (var dc = -1; dc <= 1 && !exposed; dc++) {
            if (dc === 0 && dr === 0) continue;
            if (map.isWalkable(cc2 + dc, r + dr)) exposed = true;
          }
        }
        if (exposed) wallCells.push({ col: cc2, row: r });
      }
    }
    this.wallCells = wallCells;

    var boxGeo = this._track(new THREE.BoxGeometry(T, H, T));
    setBoxFaceColors(boxGeo);
    var wallMat = this._track(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    var inst = new THREE.InstancedMesh(boxGeo, wallMat, wallCells.length);
    var m = new THREE.Matrix4();
    for (var w = 0; w < wallCells.length; w++) {
      var wc = wallCells[w];
      m.makeTranslation((wc.col + 0.5) * T, H * 0.5, (wc.row + 0.5) * T);
      inst.setMatrixAt(w, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    this.walls = inst;
    this.group.add(inst);

    /* --- 壁の稜線（角が読めるように） --- */
    var el = [];
    for (var e = 0; e < wallCells.length; e++) {
      var ec = wallCells[e];
      var ax = ec.col * T, bx = ax + T, az = ec.row * T, bz = az + T;
      var xs = [ax, bx], zs = [az, bz];
      for (var a = 0; a < 2; a++) {
        for (var b = 0; b < 2; b++) {
          el.push(xs[a], 0, zs[b], xs[a], H, zs[b]);          // 垂直
        }
      }
      el.push(ax, H, az, bx, H, az, bx, H, az, bx, H, bz,
              bx, H, bz, ax, H, bz, ax, H, bz, ax, H, az);      // 上面の枠
    }
    var edgeGeo = this._track(new THREE.BufferGeometry());
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(el), 3));
    var edgeMat = this._track(new THREE.LineBasicMaterial({ color: 0x7c8894, transparent: true, opacity: 0.5, fog: true }));
    this.edges = new THREE.LineSegments(edgeGeo, edgeMat);
    this.group.add(this.edges);

    /* --- 天井 --- */
    var ceilGeo = this._track(new THREE.PlaneGeometry(map.width * T, map.height * T));
    var ceilMat = this._track(new THREE.MeshBasicMaterial({ color: COLOR.ceil, side: THREE.DoubleSide, fog: true }));
    this.ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    this.ceiling.rotation.x = Math.PI / 2;
    this.ceiling.position.set(map.width * T * 0.5, H, map.height * T * 0.5);
    this.group.add(this.ceiling);
  };

  World.prototype.dispose = function () {
    for (var i = 0; i < this.disposables.length; i++) {
      var d = this.disposables[i];
      if (d && d.dispose) d.dispose();
    }
    this.disposables.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  };

  World.FOG_COLOR = COLOR.fog;
  ESCAPE.World = World;
})(window);
