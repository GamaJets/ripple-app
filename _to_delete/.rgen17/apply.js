const fs = require('fs');
const F = 'src/ui/habits.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 56)); process.exit(1); } s = s.replace(a, b); }
// import AsyncStorage
rep("import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';",
    "import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';\nimport AsyncStorage from '@react-native-async-storage/async-storage';");
// hydration flag
rep("  const [water, setWater] = useState(0);",
    "  const [water, setWater] = useState(0);\n  const [wHydrated, setWHydrated] = useState(false);");
// water persist + hydrate (keyed by day so it resets naturally on a new day)
rep("  const waterGoal = 8;\n",
    "  const waterGoal = 8;\n  useEffect(() => { AsyncStorage.getItem('repple.water:' + today()).then((r) => { const n = r ? parseInt(r, 10) : 0; if (Number.isFinite(n) && n > 0) setWater(n); setWHydrated(true); }); }, []);\n  useEffect(() => { if (!wHydrated) return; AsyncStorage.setItem('repple.water:' + today(), String(water)).catch(() => {}); }, [water, wHydrated]);\n");
fs.writeFileSync(F, s); console.log('applied OK');
