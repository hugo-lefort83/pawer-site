/*! Marionnettes de chiens Pawer : moteur web autonome, sans dépendance.
 *
 * Même calcul que l'application (src/components/dog/puppet/moteur.ts) et que
 * l'aperçu validé (scripts/dog-puppets/apercu.cjs) : un dessin de race découpé
 * en pièces, chaque pièce un maillage dont les sommets suivent un squelette
 * (deux os au plus par sommet), os animés par des pistes échantillonnées
 * (spline de Catmull-Rom refermée sur la boucle).
 *
 * Rendu : UN seul contexte WebGL partagé, hors page, dessine chaque chien puis
 * le recopie dans le <canvas> 2D de son élément. Aucune limite de contextes
 * WebGL (Chrome en perd au-delà de 16), une seule copie de chaque atlas.
 *
 *   Marionnette.monter(element, { race, pose, base })  -> contrôleur
 *   Marionnette.monterTout(racine?, { base })           -> contrôleurs
 *   <script src="marionnettes.js" data-monter defer>     -> monterTout() automatique
 *
 * Fichiers lus : base + '/<race>-<pose>.json' et base + '/<race>-<pose>.webp'.
 */
(function (global) {
  'use strict';

  // Dossier des données par défaut : « ../marionnettes/ » à côté du dossier du
  // script (assets/js/marionnettes.js -> assets/marionnettes/), ce qui marche
  // aussi bien en ligne qu'avec des liens relatifs (aperçu).
  var script = typeof document !== 'undefined' && document.currentScript;
  var BASE = script && script.src ? new URL('../marionnettes', script.src).href : '/assets/marionnettes';

  var CANAUX = 5; // rotation (degrés), x, y (px), échelle x, échelle y (ajoutée à 1)
  var CANAL_Y = 2;

  // Repères de chaque race sur ses six poses, en pixels du dessin source :
  // demi-largeur autour du centre du dessin, hauteur au-dessus du sol (bas du
  // dessin), débord sous le sol. Ils donnent UNE échelle par race, comme dans
  // l'application.
  // Table écrite par outils/exporter.cjs : ne pas modifier à la main.
  var RACES = /*RACES*/{"berger-allemand":{"demiL":276,"haut":436,"bas":39},"berger-australien":{"demiL":233,"haut":427,"bas":37},"bouledogue-francais":{"demiL":225,"haut":446,"bas":15},"chihuahua":{"demiL":227,"haut":500,"bas":21},"golden-retriever":{"demiL":292,"haut":452,"bas":29},"husky":{"demiL":264,"haut":494,"bas":23},"labrador":{"demiL":264,"haut":453,"bas":30},"teckel":{"demiL":290,"haut":360,"bas":24}}/*FIN*/;

  // ---------- Moteur (port fidèle de moteur.ts) ----------

  function valeurPiste(v, t) {
    var n = v.length;
    if (n === 0) return 0;
    if (n === 1) return v[0];
    var u = (t - Math.floor(t)) * n;
    if (u >= n) u = 0;
    var i = Math.floor(u);
    var f = u - i;
    var p0 = v[(i - 1 + n) % n], p1 = v[i], p2 = v[(i + 1) % n], p3 = v[(i + 2) % n];
    var f2 = f * f, f3 = f2 * f;
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
  }

  // Matrices des os au temps t (0..1) : a, b, c, d, e, f par os
  function evaluerOs(P, t) {
    var d = P.donnees, nOs = d.os.length, canaux = P.canaux, m = P.matrices, k, i;
    canaux.fill(0);
    for (k = 0; k < d.pistes.length; k++) {
      var piste = d.pistes[k];
      canaux[piste.os * CANAUX + piste.canal] += valeurPiste(piste.valeurs, t);
    }
    for (i = 0; i < nOs; i++) {
      var os = d.os[i], b = i * CANAUX;
      var angle = (canaux[b] * Math.PI) / 180;
      var sx = Math.max(0, 1 + canaux[b + 3]);
      var sy = Math.max(0, 1 + canaux[b + 4]);
      var cos = Math.cos(angle), sin = Math.sin(angle);
      var la = cos * sx, lb = sin * sx, lc = -sin * sy, ld = cos * sy;
      var le = os.x + canaux[b + 1] - (la * os.x + lc * os.y);
      var lf = os.y + canaux[b + 2] - (lb * os.x + ld * os.y);
      var o = i * 6;
      if (os.parent < 0) {
        m[o] = la; m[o + 1] = lb; m[o + 2] = lc; m[o + 3] = ld; m[o + 4] = le; m[o + 5] = lf;
      } else {
        var p = os.parent * 6;
        var pa = m[p], pb = m[p + 1], pc = m[p + 2], pd = m[p + 3], pe = m[p + 4], pf = m[p + 5];
        m[o] = pa * la + pc * lb;
        m[o + 1] = pb * la + pd * lb;
        m[o + 2] = pa * lc + pc * ld;
        m[o + 3] = pb * lc + pd * ld;
        m[o + 4] = pa * le + pc * lf + pe;
        m[o + 5] = pb * le + pd * lf + pf;
      }
    }
    return m;
  }

  // Tous les sommets déformés, pièces mises bout à bout dans l'ordre d'affichage
  function deformer(P, m) {
    var s = P.sommets, w = P.poids, out = P.positions, n = s.length / 2;
    for (var i = 0; i < n; i++) {
      var x = s[i * 2], y = s[i * 2 + 1];
      var o1 = w[i * 4] * 6, w1 = w[i * 4 + 1], o2 = w[i * 4 + 2] * 6, w2 = w[i * 4 + 3];
      out[i * 2] = w1 * (m[o1] * x + m[o1 + 2] * y + m[o1 + 4]) + w2 * (m[o2] * x + m[o2 + 2] * y + m[o2 + 4]);
      out[i * 2 + 1] = w1 * (m[o1 + 1] * x + m[o1 + 3] * y + m[o1 + 5]) + w2 * (m[o2 + 1] * x + m[o2 + 3] * y + m[o2 + 5]);
    }
    return out;
  }

  // Hauteur du saut (translation y de la racine, négative vers le haut) pour l'ombre
  function hauteurRacine(P, t) {
    var total = 0, d = P.donnees;
    for (var k = 0; k < d.pistes.length; k++) {
      var piste = d.pistes[k];
      if (piste.os === 0 && piste.canal === CANAL_Y) total += valeurPiste(piste.valeurs, t);
    }
    return total;
  }

  // ---------- Données : une pose chargée une fois, partagée par tous les chiens ----------

  var poses = {};

  function preparer(donnees, image) {
    var nV = 0, nI = 0, k, j;
    for (k = 0; k < donnees.pieces.length; k++) {
      nV += donnees.pieces[k].sommets.length / 2;
      nI += donnees.pieces[k].indices.length;
    }
    var sommets = new Float32Array(nV * 2), uv = new Float32Array(nV * 2), poids = new Float32Array(nV * 4);
    var indices = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
    var v = 0, ii = 0, A = donnees.atlas;
    for (k = 0; k < donnees.pieces.length; k++) {
      var piece = donnees.pieces[k], n = piece.sommets.length / 2;
      for (j = 0; j < n; j++) {
        sommets[(v + j) * 2] = piece.sommets[j * 2];
        sommets[(v + j) * 2 + 1] = piece.sommets[j * 2 + 1];
        uv[(v + j) * 2] = piece.uv[j * 2] / A.largeur;
        uv[(v + j) * 2 + 1] = piece.uv[j * 2 + 1] / A.hauteur;
      }
      poids.set(piece.poids, v * 4);
      for (j = 0; j < piece.indices.length; j++) indices[ii++] = piece.indices[j] + v;
      v += n;
    }
    return {
      donnees: donnees, image: image, sommets: sommets, uv: uv, poids: poids, indices: indices,
      positions: new Float32Array(nV * 2),
      canaux: new Float64Array(donnees.os.length * CANAUX),
      matrices: new Float64Array(donnees.os.length * 6),
      gpu: null,
    };
  }

  function charger(base, race, pose) {
    var cle = base + '|' + race + '|' + pose;
    if (!poses[cle]) {
      var racine = base.replace(/\/+$/, '') + '/' + race + '-' + pose;
      var json = fetch(racine + '.json').then(function (r) {
        if (!r.ok) throw new Error('Marionnette introuvable : ' + racine + '.json');
        return r.json();
      });
      var image = new Promise(function (ok, ko) {
        var i = new Image();
        i.decoding = 'async';
        i.onload = function () { ok(i); };
        i.onerror = function () { ko(new Error('Atlas illisible : ' + racine + '.webp')); };
        i.src = racine + '.webp';
      });
      poses[cle] = Promise.all([json, image]).then(function (r) { return preparer(r[0], r[1]); });
      poses[cle].catch(function () { delete poses[cle]; });
    }
    return poses[cle];
  }

  // ---------- WebGL partagé ----------

  var G = null; // { canvas, gl, prog, loc, perdu, impossible, larg, haut }
  var toutes = []; // poses préparées ayant des ressources GPU

  function compiler(gl, type, code) {
    var s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    return s;
  }

  function initialiserProgramme() {
    var gl = G.gl;
    var prog = gl.createProgram();
    gl.attachShader(prog, compiler(gl, gl.VERTEX_SHADER,
      'attribute vec2 p; attribute vec2 uv; uniform vec2 taille; uniform float echelle; uniform vec2 decalage; varying vec2 v;' +
      'void main(){ vec2 q = (p * echelle + decalage) / taille * 2.0 - 1.0; gl_Position = vec4(q.x, -q.y, 0.0, 1.0); v = uv; }'));
    gl.attachShader(prog, compiler(gl, gl.FRAGMENT_SHADER,
      'precision highp float; varying vec2 v; uniform sampler2D tex; void main(){ gl_FragColor = texture2D(tex, v); }'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { G.impossible = true; return; }
    gl.useProgram(prog);
    G.loc = {
      p: gl.getAttribLocation(prog, 'p'), uv: gl.getAttribLocation(prog, 'uv'),
      taille: gl.getUniformLocation(prog, 'taille'), echelle: gl.getUniformLocation(prog, 'echelle'),
      decalage: gl.getUniformLocation(prog, 'decalage'),
    };
    G.uint32 = !!gl.getExtension('OES_element_index_uint');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
  }

  function contexte() {
    if (G) return G.impossible || G.perdu ? null : G;
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: false });
    G = { canvas: canvas, gl: gl, perdu: false, impossible: !gl };
    if (!gl) return null;
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      G.perdu = true;
      toutes.forEach(function (P) { P.gpu = null; });
      toutes = [];
    });
    canvas.addEventListener('webglcontextrestored', function () {
      G.perdu = false;
      initialiserProgramme();
      chiens.forEach(function (c) { c.dessine = false; dessinerSiFixe(c); });
    });
    initialiserProgramme();
    return G.impossible ? null : G;
  }

  function ressources(P) {
    if (P.gpu) return P.gpu;
    var gl = G.gl;
    if (P.indices instanceof Uint32Array && !G.uint32) return null;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, P.image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var bp = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bp);
    gl.bufferData(gl.ARRAY_BUFFER, P.positions.byteLength, gl.DYNAMIC_DRAW);
    var buv = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buv);
    gl.bufferData(gl.ARRAY_BUFFER, P.uv, gl.STATIC_DRAW);
    var bi = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, P.indices, gl.STATIC_DRAW);
    P.gpu = { tex: tex, bp: bp, buv: buv, bi: bi, type: P.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    toutes.push(P);
    return P.gpu;
  }

  // ---------- Chiens montés ----------

  var chiens = [];
  var reduit = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var raf = 0, precedent = 0, imagesRendues = 0;

  // Échelle et placement. Le bas de l'élément est la ligne de sol du dessin
  // (bas des pattes au repos). Ce qui descend sous le sol pendant la boucle
  // (pattes de la marche, réception du saut) est dessiné dans une bande sous
  // l'élément : le canvas déborde vers le bas d'autant, jamais ailleurs.
  function placer(c) {
    var W = c.element.clientWidth, H = c.element.clientHeight;
    var dpr = Math.min(global.devicePixelRatio || 1, c.dprMax);
    var debord = 0;
    if (c.P) {
      var d = c.P.donnees, e = d.emprise, cx = d.largeur / 2;
      var propre = {
        demiL: Math.max(cx - e.x, e.x + e.largeur - cx),
        haut: d.hauteur - e.y,
        bas: Math.max(0, e.y + e.hauteur - d.hauteur),
      };
      var ref = c.ajuster === 'pose' ? propre : (RACES[c.race] || propre);
      var s = typeof c.echelle === 'number' && c.echelle > 0 ? c.echelle : Math.min(W / (2 * ref.demiL), H / ref.haut);
      debord = Math.ceil(Math.max(propre.bas, c.ombre ? d.largeur * 0.06 : 0) * s) + 4;
      c.s = s;
      c.ox = W / 2 - cx * s; // centre du dessin au centre de l'élément
      c.oy = H - d.hauteur * s; // ligne de sol du dessin sur le bas de l'élément
    }
    c.canvas.style.height = debord ? 'calc(100% + ' + debord + 'px)' : '100%';
    var w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round((H + debord) * dpr));
    if (c.canvas.width !== w || c.canvas.height !== h) { c.canvas.width = w; c.canvas.height = h; }
    c.W = W; c.H = H; c.dpr = dpr;
  }

  function rendre(c) {
    var P = c.P;
    if (!P || !c.W || !c.H) return false;
    var g = contexte();
    if (!g) return false;
    var gpu = ressources(P);
    if (!gpu) return false;
    var gl = g.gl, w = c.canvas.width, h = c.canvas.height;
    if (g.canvas.width < w || g.canvas.height < h) {
      g.canvas.width = Math.max(g.canvas.width, w);
      g.canvas.height = Math.max(g.canvas.height, h);
    }
    var y0 = g.canvas.height - h; // région en haut à gauche de l'image partagée
    gl.viewport(0, y0, w, h);
    gl.scissor(0, y0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    var t = c.fixe ? 0 : ((c.temps / P.donnees.duree) % 1);
    deformer(P, evaluerOs(P, t));
    gl.bindTexture(gl.TEXTURE_2D, gpu.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.bp);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, P.positions);
    gl.enableVertexAttribArray(g.loc.p);
    gl.vertexAttribPointer(g.loc.p, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buv);
    gl.enableVertexAttribArray(g.loc.uv);
    gl.vertexAttribPointer(g.loc.uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.bi);
    gl.uniform2f(g.loc.taille, w, h);
    gl.uniform1f(g.loc.echelle, c.s * c.dpr);
    gl.uniform2f(g.loc.decalage, c.ox * c.dpr, c.oy * c.dpr);
    gl.drawElements(gl.TRIANGLES, P.indices.length, gpu.type, 0);

    var ctx = c.ctx;
    ctx.clearRect(0, 0, w, h);
    if (c.ombre) {
      // Ombre au sol sous la racine ; elle rétrécit et pâlit quand le chien saute
      var d = P.donnees, k = c.s * c.dpr;
      var lever = Math.max(0, -hauteurRacine(P, t));
      var r = 1 / (1 + lever / 60);
      ctx.save();
      ctx.globalAlpha = c.ombre * r;
      ctx.fillStyle = '#2B1D12';
      ctx.beginPath();
      ctx.ellipse((c.ox + d.os[0].x * c.s) * c.dpr, (c.oy + d.hauteur * c.s) * c.dpr - 2 * c.dpr,
        d.largeur * 0.36 * k * (0.6 + 0.4 * r), d.largeur * 0.045 * k, 0, 0, Math.PI * 2);
      ctx.filter = 'blur(' + Math.round(3 * c.dpr) + 'px)';
      ctx.fill();
      ctx.restore();
    }
    ctx.drawImage(g.canvas, 0, 0, w, h, 0, 0, w, h);
    imagesRendues++;
    if (!c.dessine) {
      c.dessine = true;
      c.element.classList.add('marionnette-prete');
      var replis = c.element.querySelectorAll(':scope > img');
      for (var i = 0; i < replis.length; i++) replis[i].style.visibility = 'hidden';
      if (c.surPret) c.surPret();
    }
    return true;
  }

  function enCours(c) {
    return c.P && c.visible && !c.pause && !c.fixe && !document.hidden;
  }

  function boucle(maintenant) {
    raf = 0;
    var dt = precedent ? Math.min(100, maintenant - precedent) : 0;
    precedent = maintenant;
    var actifs = 0;
    for (var i = 0; i < chiens.length; i++) {
      var c = chiens[i];
      if (!enCours(c)) continue;
      c.temps += dt;
      rendre(c);
      actifs++;
    }
    if (actifs) raf = global.requestAnimationFrame(boucle);
    else precedent = 0;
  }

  function relancer() {
    if (raf || document.hidden) return;
    for (var i = 0; i < chiens.length; i++) {
      if (enCours(chiens[i])) { precedent = 0; raf = global.requestAnimationFrame(boucle); return; }
    }
  }

  function dessinerSiFixe(c) {
    if (!c.P) return;
    if (c.fixe || !c.dessine || !enCours(c)) rendre(c);
    relancer();
  }

  var observateur = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(function (entrees) {
    entrees.forEach(function (e) {
      var c = e.target.__marionnette;
      if (!c) return;
      c.visible = e.isIntersecting;
      if (c.visible) dessinerSiFixe(c);
    });
  }, { rootMargin: '120px 0px' }) : null;

  var approche = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(function (entrees) {
    entrees.forEach(function (e) {
      var c = e.target.__marionnette;
      if (!c || !e.isIntersecting) return;
      approche.unobserve(e.target);
      if (c.charger) c.charger();
    });
  }, { rootMargin: '600px 0px' }) : null;

  var redim = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function (entrees) {
    entrees.forEach(function (e) {
      var c = e.target.__marionnette;
      if (!c) return;
      placer(c);
      if (c.P && (c.fixe || !enCours(c))) rendre(c);
    });
  }) : null;

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) relancer();
  });

  function appliquerMouvementReduit() {
    chiens.forEach(function (c) {
      c.fixe = reduit.matches;
      if (c.fixe) c.temps = 0;
      if (c.P && c.visible) rendre(c);
    });
    relancer();
  }
  if (reduit.addEventListener) reduit.addEventListener('change', appliquerMouvementReduit);
  else if (reduit.addListener) reduit.addListener(appliquerMouvementReduit);

  /**
   * Monte une marionnette dans `element` (un <canvas> qui le remplit).
   * options :
   *   race, pose   (sinon data-race, data-pose de l'élément)
   *   base         dossier des données (sinon data-base, sinon ../marionnettes à côté du script)
   *   ajuster      'race' (défaut : une échelle par race, celle qui loge ses six poses)
   *                | 'pose' (loge seulement cette pose)
   *   echelle      nombre : pixels CSS par pixel du dessin (prime sur ajuster)
   *   ombre        opacité de l'ombre au sol, 0 pour aucune (défaut 0.22)
   *   decalage     avance dans la boucle, en ms (défaut 0)
   *   dprMax       densité maximale du canvas (défaut 2)
   * Retour : { element, pret (Promise), pause(), reprendre(), aller(ms), demonter() }
   */
  function monter(element, options) {
    options = options || {};
    if (element.__marionnette) return element.__marionnette.controle;
    var ds = element.dataset || {};
    var c = {
      element: element,
      race: options.race || ds.race,
      pose: options.pose || ds.pose,
      base: options.base || ds.base || BASE,
      ajuster: options.ajuster || ds.ajuster || 'race',
      echelle: options.echelle != null ? Number(options.echelle) : (ds.echelle ? Number(ds.echelle) : null),
      ombre: options.ombre != null ? Number(options.ombre) : (ds.ombre != null ? Number(ds.ombre) : 0.22),
      dprMax: options.dprMax || 2,
      temps: Number(options.decalage || ds.decalage || 0),
      visible: !observateur,
      pause: false,
      fixe: reduit.matches,
      dessine: false,
      P: null,
    };
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'marionnette-canvas';
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none';
    if (global.getComputedStyle(element).position === 'static') element.style.position = 'relative';
    element.appendChild(canvas);
    c.canvas = canvas;
    c.ctx = canvas.getContext('2d');
    element.__marionnette = c;
    chiens.push(c);
    placer(c);
    if (observateur) observateur.observe(element);
    if (redim) redim.observe(element);

    // Les données ne sont chargées qu'à l'approche de l'écran (marge de 600 px)
    var pret = new Promise(function (ok, ko) {
      if (!c.race || !c.pose) { ko(new Error('race et pose sont requises')); return; }
      c.surPret = ok;
      c.charger = function () {
        c.charger = null;
        charger(c.base, c.race, c.pose).then(function (P) {
          if (!element.__marionnette) return;
          c.P = P;
          placer(c);
          if (!contexte()) throw new Error('WebGL indisponible : image de repli conservée');
          if (c.visible) dessinerSiFixe(c);
        }).catch(function (err) {
          element.classList.add('marionnette-repli');
          canvas.remove();
          ko(err);
        });
      };
      if (approche) approche.observe(element); else c.charger();
    });
    pret.catch(function () {});

    c.controle = {
      element: element,
      pret: pret,
      pause: function () { c.pause = true; },
      reprendre: function () { c.pause = false; relancer(); },
      /** Place la boucle à `ms` millisecondes et redessine (synchronisation, captures) */
      aller: function (ms) { c.temps = ms; if (c.P) rendre(c); },
      demonter: function () {
        if (observateur) observateur.unobserve(element);
        if (approche) approche.unobserve(element);
        if (redim) redim.unobserve(element);
        chiens.splice(chiens.indexOf(c), 1);
        canvas.remove();
        element.classList.remove('marionnette-prete');
        var replis = element.querySelectorAll(':scope > img');
        for (var i = 0; i < replis.length; i++) replis[i].style.visibility = '';
        delete element.__marionnette;
      },
    };
    return c.controle;
  }

  /** Monte tous les `.chien-marionnette[data-race][data-pose]` sous `racine` */
  function monterTout(racine, options) {
    var liste = (racine || document).querySelectorAll('.chien-marionnette[data-race][data-pose]');
    var out = [];
    for (var i = 0; i < liste.length; i++) out.push(monter(liste[i], options));
    return out;
  }

  // <script src=".../marionnettes.js" data-monter defer> : monte tout seul les .chien-marionnette
  if (script && script.hasAttribute('data-monter')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { monterTout(); });
    else monterTout();
  }

  global.Marionnette = {
    monter: monter,
    monterTout: monterTout,
    races: RACES,
    /** Proportion largeur / hauteur d'un élément qui loge toutes les poses d'une race à la même échelle */
    proportion: function (race) { var r = RACES[race]; return r ? (2 * r.demiL) / r.haut : null; },
    /** Pour les tests : chiens montés, chiens animés, images rendues depuis le chargement */
    etat: function () {
      return {
        montes: chiens.length,
        animes: chiens.filter(enCours).length,
        prets: chiens.filter(function (c) { return c.dessine; }).length,
        images: imagesRendues,
        mouvementReduit: !!reduit.matches,
      };
    },
  };
})(typeof window !== 'undefined' ? window : this);
