# Release Notes / Patch Notes

## v0.2.0 — Overleaf-Style Cite Management & Clipboard Image Paste (2026-11-18)

### 1. Overleaf 스타일 참고문헌(`Cite`) 및 BibTeX 관리
* **좌측 메뉴바 `인용·Cite` 탭 추가**:
  * **BibTeX 일괄 가져오기**: `@inproceedings{hewitt1973, ...}` 등 BibTeX 텍스트를 붙여넣으면 저자, 제목, 연도, 학회/출처, URL을 자동으로 파싱해 `.writer/references.json`에 저장합니다.
  * **직접 등록 및 원클릭 인용 삽입**: 참고문헌 카드에서 **`[본문에 인용 삽입]`**을 누르면 현재 작성 중인 문단에 `[@키]` 토큰이 즉시 들어갑니다.
* **자동 번호 매김 & `References` 섹션 생성**:
  * 본문에 `[@키]` 또는 `\cite{키}`를 작성하면 티스토리 미리보기 및 복붙용 HTML 컴파일 시 등장 순서대로 `[1]`, `[2]`... 링크로 자동 변환되며, 글 최하단에 깔끔한 **`References`** 목록이 자동 생성됩니다.

### 2. 클립보드 이미지 바로 붙여넣기 (`Cmd + V`)
* 스크린샷(`Cmd + Ctrl + Shift + 4`)을 찍거나 웹/Finder에서 이미지를 복사한 뒤, Writer 에디터에서 **`Cmd + V`**를 누르면 클립보드 이미지를 즉시 감지합니다.
* 자동으로 **GPS 메타데이터 제거 + WebP 최적화 변환**을 거쳐 현재 포커스된 문단 바로 아래에 이미지 블록으로 삽입됩니다.

### 3. iCam 필름 스톡 프리셋 10종 & 본문 드래그앤드롭
* `Portra 400`, `Gold 200`, `Pro 400H`, `Ektar 100`, `CineStill`, `Vista 400`, `Velvia 50`, `Tri-X 400`, `Ilford HP5` 등 10종의 필름 색감 프리셋을 지원합니다.
* 에디터 어디에나 사진 파일을 드래그해서 놓으면 즉시 임포트 및 필터 편집 창이 열립니다.
