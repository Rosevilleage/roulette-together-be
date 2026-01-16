# Roulette Together 리팩토링 계획

> **작성일**: 2026-01-16
> **기준 문서**: [NESTJS_BEST_PRACTICES_REVIEW.md](../../NESTJS_BEST_PRACTICES_REVIEW.md)

## 개요

NestJS 베스트 프랙티스 평가 결과(6.5/10)를 바탕으로 프로젝트 품질을 향상시키기 위한 리팩토링 계획입니다.

## 계획 문서 구조

| 파일                                       | 우선순위    | 설명               |
| ------------------------------------------ | ----------- | ------------------ |
| [phase-1-critical.md](phase-1-critical.md) | 🔴 Critical | 즉시 필요한 작업   |
| [phase-2-high.md](phase-2-high.md)         | 🟠 High     | 높은 우선순위 작업 |
| [phase-3-medium.md](phase-3-medium.md)     | 🟡 Medium   | 중간 우선순위 작업 |
| [phase-4-low.md](phase-4-low.md)           | 🟢 Low      | 낮은 우선순위 작업 |

## 우선순위 기준

- **Critical**: 보안 위험 또는 프로덕션 배포 차단 요소
- **High**: 코드 품질 및 유지보수성에 직접적 영향
- **Medium**: 성능 최적화 및 개발자 경험 개선
- **Low**: 문서화 및 부가 기능

## 예상 작업 범위

### Phase 1: Critical (즉시)

- [ ] 테스트 인프라 구축 및 핵심 테스트 작성
- [ ] 환경 설정 보안 조치

### Phase 2: High

- [ ] NestJS Logger 도입
- [ ] 전역 예외 필터 구현
- [ ] 설정 검증 모듈 추가

### Phase 3: Medium

- [ ] 긴 메서드 리팩토링
- [ ] N+1 쿼리 패턴 해결
- [ ] Rate Limiting 추가

### Phase 4: Low

- [ ] DTO 문서화 완성
- [ ] Health Check 엔드포인트
- [ ] 모니터링 기반 구축

## 진행 상황 추적

각 Phase 문서에서 체크리스트로 진행 상황을 추적합니다.

```
- [ ] 미완료
- [x] 완료
- [ ] ~취소~ (취소선으로 표시)
```

## 참고 자료

- [NestJS 공식 문서](https://docs.nestjs.com/)
- [NestJS Best Practices](https://docs.nestjs.com/faq/common-mistakes)
- [프로젝트 CLAUDE.md](../../CLAUDE.md)
