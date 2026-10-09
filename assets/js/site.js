/* Pawer : script commun à toutes les pages, chargé en fin de <body>.
   1. Consentement et Google Analytics 4 (mode de consentement v2, tout refusé
      par défaut ; gtag.js n'est chargé qu'après « Accepter »). L'identifiant
      vient de <meta name="pawer-ga"> : vide dans l'aperçu, donc rien ne part.
   2. Événements : clic_google_play, clic_courriel, lecture_faq.
   3. Animations : pause hors écran ([data-anim] reçoit .hors-ecran),
      « réduire les animations » suivi en direct, remplissage des anneaux
      ([data-anneaux] reçoit .remplir), chien blanc Lottie servi par le site. */
(function () {
  'use strict';
  var racine = document.documentElement.getAttribute('data-racine') || '/';
  var meta = document.querySelector('meta[name="pawer-ga"]');
  var ID = meta ? meta.getAttribute('content') : '';
  var CLE = 'pawer-consentement';
  var SIX_MOIS = 1000 * 60 * 60 * 24 * 182;
  var tous = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ─── 1. Consentement ─────────────────────────────────────────────── */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });

  function lire() {
    try {
      var v = JSON.parse(localStorage.getItem(CLE));
      if (v && Date.now() - v.date < SIX_MOIS) return v.choix;
    } catch (e) {}
    return null;
  }
  function ecrire(c) { try { localStorage.setItem(CLE, JSON.stringify({ choix: c, date: Date.now() })); } catch (e) {} }
  var charge = false;
  function chargerGA() {
    if (charge || !/^G-[A-Z0-9]+$/.test(ID || '')) return;
    charge = true;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    // Cookies limités à l'hôte exact (pas au domaine parent studiohlf.com), 13 mois, durée non prolongée à chaque visite
    gtag('config', ID, { cookie_domain: location.hostname, cookie_expires: 33696000, cookie_update: false });
  }
  function supprimerCookiesGA() {
    document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (/^_ga/.test(n)) {
        document.cookie = n + '=; Max-Age=0; path=/; domain=.' + location.hostname.split('.').slice(-2).join('.');
        document.cookie = n + '=; Max-Age=0; path=/; domain=' + location.hostname;
        document.cookie = n + '=; Max-Age=0; path=/';
      }
    });
  }
  var bandeau = document.getElementById('consentement');
  function appliquer(c) {
    ecrire(c);
    if (bandeau) bandeau.hidden = true;
    if (c === 'accepte') chargerGA();
    else { gtag('consent', 'update', { analytics_storage: 'denied' }); supprimerCookiesGA(); }
  }
  if (bandeau) {
    bandeau.addEventListener('click', function (e) {
      var b = e.target.closest('[data-choix]');
      if (b) appliquer(b.getAttribute('data-choix'));
    });
  }
  tous('[data-gerer-cookies]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (!bandeau) return;
      bandeau.hidden = false;
      var premier = bandeau.querySelector('button');
      if (premier) premier.focus();
    });
  });
  var choix = lire();
  if (choix === 'accepte') chargerGA();
  else if (!choix && bandeau) bandeau.hidden = false;

  /* ─── 2. Événements (partis seulement si GA est chargé, donc après accord) ─ */
  function page() { return document.documentElement.getAttribute('data-page') || 'maitres'; }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a || !charge) return;
    var h = a.getAttribute('href');
    if (h.indexOf('play.google.com') !== -1) gtag('event', 'clic_google_play', { page: page(), emplacement: a.getAttribute('data-emplacement') || 'autre' });
    else if (h.indexOf('mailto:') === 0) gtag('event', 'clic_courriel', { page: page(), sujet: a.getAttribute('data-sujet') || 'contact' });
  });
  tous('details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open && charge) {
        var s = d.querySelector('summary');
        gtag('event', 'lecture_faq', { page: page(), question: (s ? s.textContent : '').trim().slice(0, 100) });
      }
    });
  });

  /* ─── 3. Animations ──────────────────────────────────────────────── */
  var reduit = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var attente = null;
  function avecLottie(suite) {
    if (window.lottie) { suite(); return; }
    if (!attente) {
      attente = [];
      var s = document.createElement('script');
      s.src = racine + 'assets/lottie/lottie_svg.min.js';
      s.onload = function () { var l = attente; attente = []; l.forEach(function (f) { f(); }); };
      document.head.appendChild(s);
    }
    attente.push(suite);
  }
  function majChienBlanc(el) {
    var anim = el._pawerLottie;
    if (reduit.matches) { if (anim) anim.goToAndStop(0, true); return; }
    if (el.classList.contains('hors-ecran')) { if (anim) anim.pause(); return; }
    if (anim) { anim.play(); return; }
    avecLottie(function () {
      if (el._pawerLottie || reduit.matches) return;
      try {
        anim = window.lottie.loadAnimation({
          container: el.querySelector('.pawer-chien-blanc__compo'),
          renderer: 'svg', loop: true, autoplay: false,
          path: el.getAttribute('data-pawer-lottie'),
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true }
        });
      } catch (e) { return; }
      el._pawerLottie = anim;
      anim.addEventListener('DOMLoaded', function () { el.classList.add('pawer-lottie-pret'); majChienBlanc(el); });
    });
  }
  function remplir(el) {
    if (reduit.matches || el._rempli) return;
    el._rempli = true;
    el.classList.add('remplir');
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        e.target.classList.toggle('hors-ecran', !e.isIntersecting);
        if (e.target.hasAttribute('data-pawer-lottie')) majChienBlanc(e.target);
      });
    }, { rootMargin: '150px 0px' });
    tous('[data-anim]').forEach(function (el) { io.observe(el); });
    var ioAnneaux = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) { if (e.isIntersecting) { remplir(e.target); ioAnneaux.unobserve(e.target); } });
    }, { threshold: 0.35 });
    tous('[data-anneaux]').forEach(function (el) { ioAnneaux.observe(el); });
  } else {
    tous('[data-pawer-lottie]').forEach(majChienBlanc);
  }
  var change = function () { tous('[data-pawer-lottie]').forEach(majChienBlanc); };
  if (reduit.addEventListener) reduit.addEventListener('change', change);
  else if (reduit.addListener) reduit.addListener(change);
})();
