/**
 * Pure helpers for working with a Stremio add-on collection.
 *
 * A collection is an ordered array of:
 *   { transportUrl, transportName, manifest: {...}, flags: {...} }
 * The array order is the order the user sees in Stremio.
 */

export function addonName(addon) {
  const name = addon?.manifest?.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return addon?.transportUrl || '(unnamed add-on)';
}

export function addonId(addon) {
  const id = addon?.manifest?.id;
  return typeof id === 'string' ? id : '';
}

export function addonHost(addon) {
  try {
    return new URL(addon.transportUrl).host;
  } catch {
    return '';
  }
}

/** Stable identity for an add-on across API round-trips. */
export function addonKey(addon) {
  return `${addonId(addon)}|${addon?.transportUrl ?? ''}`;
}

export function label(addon) {
  const name = addonName(addon);
  const id = addonId(addon);
  return id && id !== name ? `${name} (${id})` : name;
}

/**
 * Resolve a user-supplied reference to an array index.
 * Accepts a 1-based position, an exact name, an id, or an unambiguous fragment.
 */
export function resolveRef(addons, ref) {
  const text = String(ref ?? '').trim();
  if (!text) throw new Error('Empty add-on reference.');

  // 1-based position, but only for a plain integer.
  if (/^\d+$/.test(text)) {
    const position = Number(text);
    if (position >= 1 && position <= addons.length) return position - 1;
    throw new Error(`Position ${position} is out of range (1-${addons.length}).`);
  }

  const needle = text.toLowerCase();

  const exactName = addons.findIndex((addon) => addonName(addon).toLowerCase() === needle);
  if (exactName !== -1) return exactName;

  const exactId = addons.findIndex((addon) => addonId(addon).toLowerCase() === needle);
  if (exactId !== -1) return exactId;

  const matches = addons
    .map((addon, index) => ({ index, haystack: `${addonName(addon)} ${addonId(addon)}`.toLowerCase() }))
    .filter((entry) => entry.haystack.includes(needle));

  if (matches.length === 1) return matches[0].index;
  if (matches.length > 1) {
    const list = matches.map((entry) => `  #${entry.index + 1}  ${label(addons[entry.index])}`).join('\n');
    throw new Error(`"${text}" matches more than one add-on:\n${list}\nUse a position or a fuller name.`);
  }
  throw new Error(`No add-on matches "${text}". Run "stremio-addon-order list" to see the collection.`);
}

/**
 * Move one add-on before or after another.
 * @returns {object[]} new array; the input is not mutated
 */
export function moveAddon(addons, fromIndex, toIndex, position = 'before') {
  if (position !== 'before' && position !== 'after') {
    throw new Error(`position must be "before" or "after", got "${position}"`);
  }
  if (fromIndex === toIndex) return addons.slice();

  const next = addons.slice();
  const [item] = next.splice(fromIndex, 1);

  // Find the target by identity in the shortened array so the maths stays right
  // regardless of whether the target was before or after the source.
  let insertAt = next.indexOf(addons[toIndex]);
  if (insertAt === -1) insertAt = Math.min(toIndex, next.length);
  if (position === 'after') insertAt += 1;

  next.splice(insertAt, 0, item);
  return next;
}

/** Apply a permutation given as indices into `addons`. */
export function applyOrder(addons, order) {
  if (order.length !== addons.length) {
    throw new Error(`Order has ${order.length} entries but the collection has ${addons.length}.`);
  }
  const seen = new Set();
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= addons.length || seen.has(index)) {
      throw new Error('Order is not a permutation of the collection.');
    }
    seen.add(index);
  }
  return order.map((index) => addons[index]);
}

/** True when two collections carry the same add-ons in the same order. */
export function sameOrder(a, b) {
  if (a.length !== b.length) return false;
  return a.every((addon, index) => addonKey(addon) === addonKey(b[index]));
}

export function names(addons) {
  return addons.map((addon) => addonName(addon));
}

/** Validate that a decoded JSON backup really looks like a collection. */
export function isCollection(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.transportUrl === 'string' &&
        entry.manifest &&
        typeof entry.manifest === 'object',
    )
  );
}
