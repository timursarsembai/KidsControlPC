const c = "'1.1.11'";
const l = "1.1.10";
const ca = c.split('.').map(Number);
const la = l.split('.').map(Number);
console.log('ca:', ca);
console.log('la:', la);
for (let i = 0; i < Math.max(ca.length, la.length); i++) {
  const vc = ca[i] || 0;
  const vl = la[i] || 0;
  if (vl > vc) { console.log('TRUE'); break; }
  if (vl < vc) { console.log('FALSE'); break; }
}
