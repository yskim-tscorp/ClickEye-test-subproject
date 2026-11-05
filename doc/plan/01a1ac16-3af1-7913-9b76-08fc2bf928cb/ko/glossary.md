---
type: plan-document
title: 사내 도서 대여 서비스 용어집
description: 입력이 섞어 쓰는 도서·책·권 등의 말을 하나로 정한 용어집
status: approved
tags: [plan, requirements]
plan: 01a1ac16-3af1-7913-9b76-08fc2bf928cb
stage: requirements
lang: ko
---

# 용어집

입력은 같은 것을 「도서」「책」「권」으로 섞어 부른다(`in/planning/m5/library-spec.md@7f3d2fb6fa6c §4`, `in/planning/m5/mockup-search.png@c9a286d2f29b`). 뒤 단계 문서·Task·질문은 아래 정식 용어만 쓴다.

| 정식 용어 | 뜻 | 피할 말 | 근거 |
|---|---|---|---|
| 도서 | 제목·저자·출판사·소개·표지로 구별되는 책의 종류(서지 단위). 검색 결과와 도서 상세의 한 항목 | 책, 서적 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §4` 2·3 |
| 권 | 서가에 놓인 실물 한 권. 같은 도서가 여러 권일 수 있고, 권마다 상태가 있다 | 책 한 권, 부, 복본, 재고 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §4` 3 |
| 권 상태 | 권의 두 상태 — 「대여 가능」, 「대여 중」 | 재고 있음/없음, 가용 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §4` 3·4 |
| 대여 가능 권수 | 한 도서에서 권 상태가 「대여 가능」인 권의 수. 0이면 「모두 대여 중」으로 보인다 | 재고 수, 잔여 수량 | `in/planning/m5/mockup-search.png@c9a286d2f29b` |
| 대여 | 임직원이 대여 가능한 권 하나를 빌리는 일. 신청 즉시 성립한다(승인 절차 없음). 연체 중인 임직원은 반납하기 전까지 새 대여를 할 수 없다 | 대출, 빌림 신청, 예약 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §4` 4, 결정 로그 seq 3 (`S1-Q3`) |
| 반납 | 임직원이 내 대여 현황에서 빌린 권을 돌려주었다고 처리하는 일. 실물은 서가에 돌려놓는다. 연체 중이어도 막지 않는다 | 반환, 입고 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §4` 6 |
| 대여 기간 | 14일 | 대출 기간 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §4` 4 |
| 반납 예정일 | 대여일에 14일을 더한 날 | 반납 기한, 만기일 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §4` 5 |
| 연체 | 반납 예정일이 지났는데 아직 반납하지 않은 상태 | 장기 미반납(입력 §1 의 설명어) | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §1`·§4 5 |
| 내 대여 현황 | 로그인한 임직원 본인이 지금 빌린 권의 목록(도서, 반납 예정일, 연체 여부)이자 반납을 처리하는 곳 | 내 대출 내역, 마이페이지 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §4` 5·6 |
| 회사 계정 | 회사가 이미 발급해 둔 사번 또는 회사 메일과 비밀번호. 이 서비스의 로그인 화면에서 입력받아 회사 계정 시스템으로 확인한다. 이 서비스는 따로 가입받거나 비밀번호를 저장하지 않는다 | 서비스 계정, 회원 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §3`, `in/planning/m5/mockup-login.png@251c22d8aace`, 결정 로그 seq 2 (`S1-Q2`) |
| 임직원 | 회사 계정으로 로그인해 도서를 찾고 빌리고 반납하는 사용자. 서비스 안에서는 회사 메일로 구분한다(사번은 저장하지 않는다) | 회원, 이용자 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §3`, 결정 로그 seq 4 (`S1-Q4`) |
| 관리자 | 총무팀 2명. 2차에 도서 등록·수정과 연체 목록 확인을 한다 | 운영자 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §3` |
| 회사 계정 인증 | 입력한 회사 계정이 맞는지 회사 계정 시스템이 확인해 주는 일 | 자체 로그인 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §3` |
| 대여 한 건 | 임직원 한 명이 권 하나를 빌린 기록 하나. 내 대여 현황의 한 줄이며 반납은 그 한 건만 처리한다. 같은 도서의 두 권을 빌리면 두 건이다 | 대여 내역 묶음 | 요구사항 US-09·US-11 에서 정함 |
| 요청 식별자 | 화면이 「대여」 제출마다 새로 발급하는 값. 같은 값으로 온 제출은 같은 요청(한 제출)으로 본다 | 중복 방지 키 | 요구사항 US-07 에서 정함 |
| 1차 / 2차 | 1차 오픈 범위(검색·대여·반납·내 대여 현황)와 그 뒤 범위(관리자 기능·연체 알림) | 1단계, 후속 | `in/planning/m5/library-spec.md@7f3d2fb6fa6c §2` |
