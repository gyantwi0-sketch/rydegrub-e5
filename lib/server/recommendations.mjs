// Explainable preference matching only. No browsing history, PNR, contact data,
// inferred health traits, external AI provider or unverified allergy guarantees.
const PREFERENCES = new Set(['Vegetarian', 'High-protein', 'Mild spice']);
export function recommend(catalog, settings) {
  const preferences = settings.granted === true ? settings.preferences.filter(p => PREFERENCES.has(p)) : [];
  const personalized = settings.granted === true && preferences.length > 0;
  const eligible = catalog.filter(p => typeof p.id === 'string' && p.active !== false &&
    p.category !== 'Toddler Food' && Array.isArray(p.tags));
  const candidates = personalized ? eligible.filter(p => preferences.every(tag => p.tags.includes(tag))) : eligible;
  return {
    mode: personalized ? 'personalized' : 'general',
    explanation: personalized ? 'Matches your saved food preferences. Review ingredients and allergens before ordering.' :
      'General menu suggestions. Personal preferences were not used.',
    items: candidates.slice(0, 3).map(p => ({ id: p.id,
      reasons: personalized ? preferences.map(tag => `Matches ${tag}`) : ['Selected from the menu'],
    })),
  };
}
