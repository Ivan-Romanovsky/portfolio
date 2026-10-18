export type Lang = 'ru' | 'en';

export const contacts = {
  telegram: 'itromanovsky',
  email: 'itromanovsky@gmail.com',
  behance: 'https://www.behance.net/a690af46',
};

export const t = {
  ru: {
    htmlLang: 'ru',
    name: 'Иван Романовский',
    title: 'Иван Романовский, веб-дизайнер',
    description: 'Проектирую интерфейсы и сайты, провожу UX- и CRO-аудиты и довожу проекты до работающего сайта.',
    nav: { cases: 'Проекты', about: 'Обо мне', services: 'Услуги', contact: 'Контакты', menu: 'Меню', close: 'Закрыть' },
    cta: 'Написать',
    hero: { line1: 'Веб-дизайнер.', line2: 'Интерфейсы, сайты, UX- и CRO-аудиты.', wordmark: 'Романовский' },
    about: {
      // the {…} part gets the mint marker
      text: 'Проектирую интерфейсы и сайты, а потом смотрю, как ими пользуются {на самом деле}. Нахожу места, где люди теряются, и превращаю их в заявки.',
      facts: [
        ['3+ года', 'в продуктовом и веб-дизайне'],
        ['VK Fresh Code 2024', 'победа вместе с командой'],
        ['Прикладная математика', 'отсюда любовь к сложным задачам'],
        ['Удалённо', 'с командами и клиентами из любого города'],
      ],
    },
    cases: { title: 'Проекты, где пришлось подумать', view: 'Смотреть', all: 'Все проекты', next: 'Следующий проект', role: 'Роль', year: 'Год', kind: 'Тип', source: 'Кейс на Behance', soon: 'обложка скоро' },
    services: {
      title: 'Чем могу помочь',
      note: 'Цены ориентировочные. Точную сумму назову после короткого брифа.',
      items: [
        { name: 'Дизайн лендинга', price: 'от 40 000 ₽', time: '1-2 недели', text: 'Структура, тексты-прототип и дизайн под одну цель: заявки, запись или продажи.' },
        { name: 'Сайт под ключ', price: 'от 90 000 ₽', time: '3-5 недель', text: 'Дизайн и вёрстка на коде. Сдаю работающий сайт, а не макет.' },
        { name: 'UX/CRO-аудит', price: 'от 25 000 ₽', time: '5-7 дней', text: 'Нахожу, где посетители теряются, и даю список правок по приоритету.' },
        { name: 'Интерфейс или приложение', price: 'от 120 000 ₽', time: 'от 4 недель', text: 'Исследование, сценарии, прототип и макеты веб- или мобильного продукта.' },
      ],
    },
    contact: { title: 'Есть задача? Давайте разберём', telegram: 'Написать в Telegram', note: '' },
    langSwitch: 'EN',
  },
  en: {
    htmlLang: 'en',
    name: 'Ivan Romanovsky',
    title: 'Ivan Romanovsky, web designer',
    description: 'I design interfaces and websites, run UX and CRO audits, and ship them as working sites.',
    nav: { cases: 'Work', about: 'About', services: 'Services', contact: 'Contact', menu: 'Menu', close: 'Close' },
    cta: 'Get in touch',
    hero: { line1: 'Web designer.', line2: 'Interfaces, websites, UX and CRO audits.', wordmark: 'Romanovsky' },
    about: {
      text: 'I design interfaces and websites, then watch how people {actually use them}. I find the spots where they get lost and turn them into leads.',
      facts: [
        ['3+ years', 'in product and web design'],
        ['VK Fresh Code 2024', 'winning team'],
        ['Applied mathematics', 'hence the love for hard problems'],
        ['Remote', 'working with teams anywhere'],
      ],
    },
    cases: { title: 'Projects that took some thinking', view: 'View', all: 'All work', next: 'Next project', role: 'Role', year: 'Year', kind: 'Type', source: 'Case on Behance', soon: 'cover coming soon' },
    services: {
      title: 'How I can help',
      note: 'Prices are a starting point. I’ll give you an exact quote after a short brief.',
      items: [
        { name: 'Landing page design', price: 'from $600', time: '1-2 weeks', text: 'Structure, draft copy and design built around one goal: leads, bookings or sales.' },
        { name: 'Website, design to code', price: 'from $1,400', time: '3-5 weeks', text: 'Design plus hand-coded build. You get a working site, not a mockup.' },
        { name: 'UX/CRO audit', price: 'from $400', time: '5-7 days', text: 'I find where visitors drop off and hand over a prioritised list of fixes.' },
        { name: 'Interface or app', price: 'from $1,900', time: '4+ weeks', text: 'Research, user flows, prototype and UI for a web or mobile product.' },
      ],
    },
    contact: { title: 'Got a project? Let’s talk', telegram: 'Message on Telegram', note: 'I work best in writing: chat and email in English. Calls are in Russian.' },
    langSwitch: 'RU',
  },
} as const;

/** Path of the same page in the other language. */
export function otherLangPath(path: string, base: string, lang: Lang) {
  const b = base.endsWith('/') ? base : base + '/';
  const rest = path.startsWith(b) ? path.slice(b.length) : path.replace(/^\//, '');
  const clean = rest.replace(/^en(\/|$)/, '');
  return lang === 'ru' ? `${b}en/${clean}` : `${b}${clean}`;
}

export const url = (base: string, p = '') => (base.endsWith('/') ? base : base + '/') + p.replace(/^\//, '');

/** Split text into masked lines for the reveal; `{…}` becomes the mint marker. */
export const words = (s: string) => s.split(/(\{[^}]+\})/).filter(Boolean);
