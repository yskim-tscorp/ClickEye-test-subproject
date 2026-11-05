const form = document.getElementById('signup-form');
const button = document.getElementById('submit');
const formError = document.getElementById('form-error');
const success = document.getElementById('success');
const fields = ['email', 'password'];

function clearErrors() {
  formError.textContent = '';
  for (const f of fields) {
    document.getElementById(`${f}-error`).textContent = '';
    document.getElementById(f).removeAttribute('aria-invalid');
  }
}

function showFieldError(field, message) {
  document.getElementById(`${field}-error`).textContent = `오류: ${message}`;
  document.getElementById(field).setAttribute('aria-invalid', 'true');
}

function showFormError(message) {
  formError.textContent = `오류: ${message}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  success.textContent = '';
  button.disabled = true;
  button.textContent = '가입 중…';
  form.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.email.value, password: form.password.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 201) {
      form.reset();
      form.hidden = true;
      success.textContent = '가입이 완료되었습니다.';
      success.focus();
    } else if (res.status === 409) {
      showFieldError('email', '이미 가입된 이메일입니다. 다른 이메일을 입력하세요.');
      form.email.focus();
    } else if (res.status === 400 && Array.isArray(body.details) && body.details.length) {
      let first = null;
      for (const d of body.details) {
        if (fields.includes(d.field)) {
          showFieldError(d.field, d.message);
          first ??= d.field;
        } else showFormError(d.message);
      }
      if (first) document.getElementById(first).focus();
    } else {
      showFormError('가입하지 못했습니다. 잠시 후 다시 시도하세요.');
    }
  } catch {
    showFormError('가입하지 못했습니다. 연결을 확인하고 다시 시도하세요.');
  } finally {
    button.disabled = false;
    button.textContent = '가입하기';
    form.removeAttribute('aria-busy');
  }
});
