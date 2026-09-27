(function () {
  const mountId = 'authCardButtonMount';
  const target = document.getElementById(mountId);

  if (!target) return;

  const button = document.createElement('button');
  button.id = 'authCardSignIn';
  button.className = 'auth-card-button';
  button.type = 'button';
  button.textContent = 'Google Sign-in';

  target.appendChild(button);
})();
