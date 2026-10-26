// Lock ("🔒") rules: which spec fields belong to which part role. Pure + injectable reader => unit-testable (tests/regen.test.js).
const LOCKMAP = { 'Голова': ['face', 'head_part', 'head_part_title', 'head_part_why_uk', 'head_glasses_printed', 'skin_color', 'head_mold'], 'Волосся': ['hair_style', 'hair_color', 'hair_secondary_color', 'hair_sculpt', 'hair_part'], 'Головний убір': ['headgear', 'headgear_color', 'headgear_secondary_color'],
  'Плащ / броня': ['neck_accessory', 'neck_accessory_color'], 'Торс': ['torso_color', 'torso_print_svg', 'torso_back_print_svg', 'collar', 'collar_color', 'torso_graphic_png', 'torso_graphic_box', 'torso_graphic_rect', 'double_torso', 'torso2', 'torso2_color', 'torso2_print_svg'],
  'Рука': ['arm_color', 'arm_print_svg'], 'Кисть': ['hand_color', 'hands_are_gloves'], 'Низ / ноги': ['legs_type', 'hip_color', 'leg_color', 'leg_right_color', 'legs_print_svg', 'hips_print_svg', 'skirt_color', 'footwear'], 'Аксесуар': ['accessories_3d'] };
const ID_RE = /^[0-9]+-[a-z0-9]{4}$/;
const cleanRoles = roles => [...new Set((Array.isArray(roles) ? roles : []).filter(r => typeof r === 'string' && Object.prototype.hasOwnProperty.call(LOCKMAP, r)))];
// locked parts are copied from the figure the user is looking at (lock_from). Returns {fixed, roles, missing}; missing=true when that figure's file is gone
function lockedFields(lock_from, roles, readOut) {
  roles = cleanRoles(roles); if (!roles.length) return { fixed: null, roles: [], missing: false };
  const old = ID_RE.test(lock_from || '') ? readOut(lock_from) : null; if (!old) return { fixed: null, roles: [], missing: true };
  const f = {}; for (const r of roles) for (const k of LOCKMAP[r]) if (old[k] !== undefined) f[k] = old[k];
  return Object.keys(f).length ? { fixed: f, roles, missing: false } : { fixed: null, roles: [], missing: false };
}
module.exports = { LOCKMAP, ID_RE, cleanRoles, lockedFields };
