// 릴리스에 올릴 파일을 만든다. `npx tauri build` 뒤에 실행한다.
//   node scripts/release-files.mjs <버전> <다운로드 주소 앞부분> [출력 폴더]
// - 설치 파일 이름을 예전과 같은 DeskCalendar-Setup-<버전>.exe로 바꿔 출력 폴더에 복사
// - 설치된 앱이 새 버전을 확인하는 latest.json을 만든다 (서명은 빌드 때 만든 .sig 내용)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [version, baseUrl, outDir = 'release'] = process.argv.slice(2);
if (!version || !baseUrl) {
  console.error('사용법: node scripts/release-files.mjs <버전> <다운로드 주소 앞부분> [출력 폴더]');
  process.exit(1);
}

const built = `src-tauri/target/release/bundle/nsis/DeskCalendar_${version}_x64-setup.exe`;
const name = `DeskCalendar-Setup-${version}.exe`;
mkdirSync(outDir, { recursive: true });
copyFileSync(built, join(outDir, name));

const latest = {
  version,
  notes: `데스크 캘린더 ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(`${built}.sig`, 'utf8').trim(),
      url: `${baseUrl.replace(/\/$/, '')}/${name}`,
    },
  },
};
writeFileSync(join(outDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
console.log(`${outDir}/${name}, ${outDir}/latest.json`);
