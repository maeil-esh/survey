/*
 * 안전 토크 라이브 GitHub Pages 설정
 * 1) GAS Code.gs를 웹앱으로 배포
 * 2) 배포된 /exec URL을 아래 GAS_API_URL에 붙여넣기
 */
window.SAFE_TALK_CONFIG = {
  GAS_API_URL: 'https://script.google.com/macros/s/AKfycbz1SDH5f5doD0DfXYLqLESm3ZJpAIJfnLT3WQFXfIgaoA9IU9LVdppT_TuaUR9-xYfBMA/exec',
  REFRESH_MS_VOTE: 1000,
  REFRESH_MS_DISPLAY: 1000,
  REFRESH_MS_ADMIN: 2000
};
