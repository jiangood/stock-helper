import { mountLegacyPage } from './legacy-page.js';
export function mount({ root }) {
  return mountLegacyPage({ root, src: 'legacy-market.html', title: '市场行情' });
}
