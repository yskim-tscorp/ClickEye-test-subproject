// AWS 접근 키는 코드에 두지 않고 환경변수에서 읽는다. 예시는 .env.example 참고.
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;

module.exports = { AWS_ACCESS_KEY_ID };
