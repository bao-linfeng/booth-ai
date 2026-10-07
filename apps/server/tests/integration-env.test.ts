import assert from 'node:assert/strict';
import { test } from 'node:test';

import { integrationVariables } from './integration-env.js';

// 集成测试在变量缺失时会 skip，输出里只显示 skipped，容易被误读为通过。
// 标准检查设置 REQUIRE_INTEGRATION_TESTS=1，缺任何一个变量都直接失败并列出缺项。
test('standard check provides every integration test variable', {
  skip: process.env.REQUIRE_INTEGRATION_TESTS !== '1' && 'set REQUIRE_INTEGRATION_TESTS=1 to require integration tests',
}, async () => {
  const names = await integrationVariables();
  assert.ok(names.includes('PROJECT_TEST_DATABASE_URL') && names.includes('THEME_TEST_REDIS_URL'), 'integration variable scan found nothing');
  assert.deepEqual(names.filter(name => !process.env[name]), []);
});
