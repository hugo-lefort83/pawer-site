/* Bouton « Copier » à côté d'une adresse : presse-papiers, sinon sélection du texte. */
(function () {
  document.querySelectorAll('[data-copier]').forEach(function (bouton) {
    bouton.addEventListener('click', function () {
      var texte = bouton.getAttribute('data-copier');
      var fait = function () {
        bouton.textContent = 'Copiée';
        setTimeout(function () { bouton.textContent = 'Copier'; }, 1800);
      };
      var selectionner = function () {
        var code = bouton.parentNode.querySelector('code');
        if (!code) return;
        var plage = document.createRange();
        plage.selectNodeContents(code);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(plage);
      };
      try { navigator.clipboard.writeText(texte).then(fait, selectionner); } catch (e) { selectionner(); }
    });
  });
})();
