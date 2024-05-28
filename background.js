let port = browser.runtime.connectNative("sso_mib");
console.log('started sso_mib')

/*
Listen for messages from the app.
*/
port.onMessage.addListener((response) => {
  console.log('Received PRT cookie');
  browser.cookies.set({
    name: response.cookieName,
    value: response.cookieContent,
    domain: 'login.microsoftonline.com',
    expirationDate: new Date().getTime() / 1000 + 3600,
    httpOnly: true,
    path: '/',
    url: 'https://login.microsoftonline.com/'
  })
  portFromCS.postMessage(response);
});

let portFromCS;
function connected(p) {
  console.log('connected')
  portFromCS = p;
  portFromCS.onMessage.addListener((m) => {
    if(m.command == "acquirePrtSsoCookie") {
      console.log("acquirePrtSsoCookie");
      prt_cookie = browser.cookies.get({name: 'x-ms-RefreshTokenCredential', url: 'https://login.microsoftonline.com/'})
      prt_cookie.then((cookie) => {
        if(cookie == null){
          port.postMessage("acquirePrtSsoCookie");
        } else {
        console.log("x-ms-RefreshTokenCredential already present");
      }});
    }
  });
}

browser.runtime.onConnect.addListener(connected);
