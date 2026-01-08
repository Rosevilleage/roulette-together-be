module.exports = {
  types: [
    { value: '✨ feat', name: '✨ feat:     새로운 기능 추가' },
    { value: '🐛 fix', name: '🐛 fix:      버그 수정' },
    { value: '📝 docs', name: '📝 docs:     문서 수정' },
    { value: '💄 style', name: '💄 style:    코드 포맷팅, 세미콜론 누락 등 (기능 변경 없음)' },
    { value: '♻️  refactor', name: '♻️  refactor: 코드 리팩토링' },
    { value: '⚡️ perf', name: '⚡️ perf:     성능 개선' },
    { value: '✅ test', name: '✅ test:     테스트 코드 추가/수정' },
    { value: '🔧 chore', name: '🔧 chore:    빌드 업무 수정, 패키지 매니저 설정 등' },
    { value: '👷 ci', name: '👷 ci:       CI 설정 파일 수정' },
    { value: '📦 build', name: '📦 build:    빌드 시스템 또는 외부 의존성 변경' },
    { value: '⏪ revert', name: '⏪ revert:   이전 커밋으로 되돌림' },
  ],

  scopes: [
    { name: 'api' },
    { name: 'auth' },
    { name: 'database' },
    { name: 'ui' },
    { name: 'config' },
    { name: 'test' },
    { name: 'deps' },
    { name: 'other' },
  ],

  messages: {
    type: '커밋 타입을 선택하세요:',
    scope: '변경 범위(scope)를 선택하세요 (선택사항):',
    customScope: '커스텀 범위를 입력하세요:',
    subject: '변경 사항에 대한 간단한 설명을 입력하세요:\n',
    body: '변경 사항에 대한 상세한 설명을 입력하세요 (선택사항). "|"로 새 줄을 구분합니다:\n',
    breaking: 'BREAKING CHANGES에 대한 설명을 입력하세요 (선택사항):\n',
    footer: '이 변경으로 인해 해결된 이슈를 입력하세요 (예: #123) (선택사항):\n',
    confirmCommit: '위의 커밋 메시지로 진행하시겠습니까?',
  },

  allowCustomScopes: true,
  allowBreakingChanges: ['feat', 'fix', 'refactor'],
  skipQuestions: ['footer'],

  subjectLimit: 100,
  breaklineChar: '|',
}