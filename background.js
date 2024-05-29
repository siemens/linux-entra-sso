console.log('started sso_mib')

let port = browser.runtime.connectNative("sso_mib");
let PRT_LIFETIME_S = 30 * 60;
let prt_sso_cookie = {
  data: {},
  validUntil: new Date(0)
};

/*
 * Helpers to wait for a value to become available
 */
let sleep = ms => new Promise(r => setTimeout(r, ms));
let waitFor = async function waitFor(f){
    while(!f()) await sleep(200);
    return f();
};

async function get_or_request_prt(){
  if(prt_sso_cookie.validUntil < new Date()){
    console.log('request new PrtSsoCookie from broker')
    port.postMessage("acquirePrtSsoCookie")
  } else {
    console.log('use cached PrtSsoCookie, valid until: ', prt_sso_cookie.validUntil);
  }
  return waitFor(() => {
    if(prt_sso_cookie.validUntil > new Date()){
      return prt_sso_cookie.data;
    }
    return false;
  })
}

/*
 * This function set a key-value pair in HTTP header "Cookie", 
 *   and returns the value of HTTP header after modification. 
 * If key already exists, it modify the value. 
 * If key doesn't exist, it add the key-value pair. 
 * If value is undefined, it delete the key-value pair from cookies. 
 *
 * Assuming that, the same key SHOULD NOT appear twice in cookies. 
 * Also assuming that, all cookies doesn't contains semicolon. 
 *   (99.9% websites are following these rules)
 *
 * Example: 
 *   cookie_keyvalues_set("msg=good; user=recolic; password=test", "user", "p")
 *     => "msg=good; user=p; password=test"
 *   cookie_keyvalues_set("msg=good; user=recolic; password=test", "time", "night")
 *     => "msg=good; user=recolic; password=test;time=night"
 *
 * Recolic K <root@recolic.net>
 * License: MPL2.0
 */
function cookie_keyvalues_set(original_cookies, key, value) {
  let new_element = " " + key + "=" + value; // not used if value is undefined. 
  let cookies_ar = original_cookies.split(";").filter(e => e.trim().length > 0);
  let selected_cookie_index = cookies_ar.findIndex(kv => kv.trim().startsWith(key+"="));
  if ((selected_cookie_index == -1) && (value != undefined)) cookies_ar.push(new_element);
  else {
      if (value === undefined)
          cookies_ar.splice(selected_cookie_index, 1);
      else
          cookies_ar.splice(selected_cookie_index, 1, new_element);
  }
  return cookies_ar.join(";");
}

async function on_before_send_headers(e){
  let header_cookie = e.requestHeaders.find(header => header.name.toLowerCase() === "cookie");
  let prt = await get_or_request_prt();
  let new_cookie = cookie_keyvalues_set(header_cookie === undefined ? "" : header_cookie.value, prt.cookieName, prt.cookieContent);
  // no cookies at all
  if (header_cookie === undefined) {
    e.requestHeaders.push({"name": "Cookie", "value": new_cookie});
  } else {
    header_cookie.value = new_cookie;
  }
  return { requestHeaders: e.requestHeaders };
}

browser.webRequest.onBeforeSendHeaders.addListener(
  on_before_send_headers,
  { urls: ["*://login.microsoftonline.com/*"] },
  ["blocking", "requestHeaders"]
)

port.onMessage.addListener((response) => {
  console.log('received PRT cookie from broker');
  prt_sso_cookie.data = response;
  prt_sso_cookie.validUntil = new Date(Date.now() + 1000 * PRT_LIFETIME_S);
});
