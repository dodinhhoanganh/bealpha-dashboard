const baseUrl = process.argv[2];
if (!baseUrl) {
  throw new Error("Usage: node tests/runtime-smoke.mjs <gateway-url>");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function json(response) {
  const body = await response.json();
  return { response, body };
}

const login = await json(
  await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@example.com",
      password: "correct-horse-battery-staple"
    })
  })
);
assert(login.response.status === 200, `login=${login.response.status}`);
const oldCookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
const firstAccess = login.body.data?.accessToken;
assert(oldCookie && firstAccess, "login tokens missing");

const firstMe = await json(
  await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${firstAccess}` }
  })
);
assert(firstMe.response.status === 200, `first me=${firstMe.response.status}`);

const refresh = await json(
  await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { cookie: oldCookie, "content-type": "application/json" },
    body: "{}"
  })
);
assert(refresh.response.status === 200, `refresh=${refresh.response.status}`);
const newCookie = refresh.response.headers.get("set-cookie")?.split(";", 1)[0];
const newAccess = refresh.body.data?.accessToken;
assert(newCookie && newAccess, "rotated tokens missing");

const secondMe = await json(
  await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${newAccess}` }
  })
);
assert(secondMe.response.status === 200, `second me=${secondMe.response.status}`);

const replay = await json(
  await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { cookie: oldCookie, "content-type": "application/json" },
    body: "{}"
  })
);
assert(replay.response.status === 401, `replay=${replay.response.status}`);
assert(
  replay.body.error?.code === "REFRESH_REUSE_DETECTED",
  `replay code=${replay.body.error?.code}`
);

const revokedMe = await json(
  await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${newAccess}` }
  })
);
assert(revokedMe.response.status === 401, `revoked me=${revokedMe.response.status}`);

console.log("PASS login=200 me=200 refresh=200 replay=401 revoked_access=401");
