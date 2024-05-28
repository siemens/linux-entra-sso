
console.log('sso-mib initialized');

let bg = browser.runtime.connect()
bg.postMessage({ command: "acquirePrtSsoCookie" });

bg.onMessage.addListener((m) => {
    console.log('got PRT cookie');
});
