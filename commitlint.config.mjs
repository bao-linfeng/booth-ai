import { createRequire } from 'node:module';

// 仓库级提交信息规则，由根目录 lefthook.yml 的 commit-msg 钩子调用。
// 仓库根目录没有 node_modules，commitlint 及其规则包复用 apps/admin 的依赖。
// 采用 Conventional Commits；scope 不限定取值（如 credits,admin），中文正文不限制单行长度。
const require = createRequire(new URL('./apps/admin/package.json', import.meta.url));

export default {
  extends: [require.resolve('@commitlint/config-conventional')],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
