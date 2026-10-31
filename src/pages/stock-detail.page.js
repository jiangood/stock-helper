import { mountLegacyPage } from './legacy-page.js';
export function mount({ root, route }) {
  const query = new URLSearchParams({ code: route.params.code });
  return mountLegacyPage({ root, src: 'legacy-stock.html?' + query.toString(), title: route.params.code + ' 个股详情' });
}
