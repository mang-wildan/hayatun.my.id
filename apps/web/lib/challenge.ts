// Challenge TOTP dibawa lewat sessionStorage, tidak pernah lewat URL (tidak masuk riwayat browser, log Nginx, atau header Referer)
const KEY = "hayatun.challenge";
export const getChallenge = () => window.sessionStorage.getItem(KEY);
export const setChallenge = (c: string) => window.sessionStorage.setItem(KEY, c);
export const clearChallenge = () => window.sessionStorage.removeItem(KEY);
