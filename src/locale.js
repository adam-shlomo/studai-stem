let language = "en";
export const setLocale = (value) => {
  language = value === "he" ? "he" : "en";
};
export const tr = (he, en) => (language === "he" ? he : en);
export const localeFor = () => (language === "he" ? "he-IL" : "en-US");
