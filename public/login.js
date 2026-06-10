async function login() {
  const pwd = document.getElementById('password').value;
  if (!pwd) return;
  const err = document.getElementById('error');
  err.classList.remove('show');
  try {
    const res = await fetch('/api/logs?hours=1', {
      headers: { 'Authorization': 'Bearer ' + pwd }
    });
    if (!res.ok) throw new Error('Unauthorized');
    sessionStorage.setItem('api_token', pwd);
    window.location.href = '/';
  } catch (e) {
    err.classList.add('show');
  }
}

document.getElementById('login-btn').onclick = login;
document.getElementById('password').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});
