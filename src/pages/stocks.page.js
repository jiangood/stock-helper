import { mountLegacyPage } from './legacy-page.js';
export function mount({ root }) {
  return mountLegacyPage({ root, src: 'legacy-stocks.html', title: '自选股票池' });
}
