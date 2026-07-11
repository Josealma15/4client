import fetch from 'node-fetch';

async function run() {
  const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dev@fruver.com', password: 'dev' })
  });
  const loginData = await loginRes.json();
  if (!loginData.data?.token) {
    console.log("Login failed", loginData);
    return;
  }
  const token = loginData.data.token;

  const patchRes = await fetch('http://localhost:3000/api/v1/config/wpp', {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      wpp_meta_token: 'EAALQ...',
      wpp_meta_phone_id: '123456789'
    })
  });
  
  const patchData = await patchRes.json();
  console.log("Patch status:", patchRes.status);
  console.log("Patch response:", patchData);
}
run();
