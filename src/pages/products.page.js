import { mountLegacyPage } from './legacy-page.js';
export function mount({ root }) {
  return mountLegacyPage({ root, src: 'legacy-products.html', title: '商品与产业链' });
}
