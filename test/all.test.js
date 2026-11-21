// node --test test/all.test.js  (wszystkie zestawy: serwer wspólny + każda gra)
import { test } from 'node:test';
import { tests } from './games/mafia/suite.js';
import { roomTests } from './games/mafia/room.suite.js';
import { tjTests } from './games/tajniacy/tajniacy.suite.js';
import { tjDuoTests } from './games/tajniacy/tajniacy-duo.suite.js';
import { mlTests } from './games/milion/milion.suite.js';
import { rzTests } from './games/rozejrzyj/rozejrzyj.suite.js';
import { kiTests } from './games/kurczacze/kurczacze.suite.js';
import { authTests } from './core/auth.suite.js';
import { plTests } from './core/players.suite.js';
import { bgTests } from './games/bulgot/bulgot.suite.js';

for (const t of [...tests, ...roomTests, ...tjTests, ...mlTests, ...rzTests, ...kiTests, ...tjDuoTests, ...authTests, ...plTests, ...bgTests]) test(t.name, t.fn);
