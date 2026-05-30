import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ru from './locales/ru.json'

const resources = {
  en: { translation: en },
  ru: { translation: ru }
}

const systemLang = navigator.language.startsWith('ru') ? 'ru' : 'en'
const savedLanguage = localStorage.getItem('appLanguage') || systemLang

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  })

export default i18n

