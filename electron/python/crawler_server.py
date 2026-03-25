"""
Kiwoom-Trader-V2 내장 크롤러 프록시 서버
원본: C:/Users/legna/Projects/260324 Crawler test/server.py 에서 필요한 기능만 추출

엔드포인트:
  GET /api/health        → 헬스체크
  GET /api/fetch_any     → md_browse 엔진 (Playwright 헤드리스 → Markdown 변환)
  GET /api/proxy_json    → 네이버 모바일 JSON API 프록시 (봇 차단 우회)
"""

import logging
import os
from flask import Flask, jsonify, request
from flask_cors import CORS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "server": "kiwoom-crawler-proxy"})


@app.route("/api/fetch_any")
def fetch_any():
    """
    md_browse 엔진: Playwright 헤드리스 브라우저로 URL 렌더링 후 Markdown 추출.
    stock.naver.com 같은 SPA 페이지도 JS 렌더링 후 추출 가능.
    
    사용법: GET /api/fetch_any?url=https://stock.naver.com/market/stock/kr/industry/1&engine=md_browse
    """
    url = request.args.get("url")
    if not url:
        return jsonify({"error": "URL is required"}), 400

    logger.info(f"Fetch request (md_browse) for URL: {url}")

    from playwright.sync_api import sync_playwright
    from bs4 import BeautifulSoup
    import markdownify

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            )
            page.goto(url, wait_until="networkidle", timeout=15000)
            page.wait_for_timeout(3000)  # SPA Hydration 대기
            html_text = page.content()
            browser.close()

        # HTML → Markdown 변환
        soup = BeautifulSoup(html_text, "lxml")
        title = soup.title.string if soup.title else "No title"

        # 불필요한 태그 제거
        for noise in soup(["script", "style", "noscript", "svg", "button", "nav", "footer"]):
            noise.decompose()

        clean_markdown = markdownify.markdownify(str(soup), heading_style="ATX")

        if clean_markdown:
            clean_markdown = "\n".join(
                [line.strip() for line in clean_markdown.split("\n") if line.strip() != ""]
            )
        else:
            clean_markdown = "내용을 파싱하지 못했습니다."

        meta_info = (
            f"Title: {title.strip()}\n"
            f"Engine: md-browse (Markdown Extraction Mode)\n"
            f"Scripts count (Rendered): {html_text.count('<script')}\n"
            f"Rendered HTML length: {len(html_text)}\n"
            f"Note: Extracted Clean Markdown Payload."
        )

        return jsonify({
            "url": url,
            "status": 200,
            "meta": meta_info,
            "text_content": clean_markdown,
            "html": html_text[:500],
        })

    except Exception as e:
        logger.error(f"Error fetching URL: {e}", exc_info=True)
        return jsonify({"error": f"Playwright/Render error: {str(e)}", "url": url}), 500


@app.route("/api/proxy_json")
def proxy_json():
    """
    네이버 모바일 JSON API 프록시.
    Node.js에서 직접 호출 시 TLS/봇 차단되므로 Python requests를 통해 우회.
    
    사용법: GET /api/proxy_json?url=https://m.stock.naver.com/api/stocks/industry/294?page=1&pageSize=20
    """
    import requests as req_lib

    target_url = request.args.get("url", "")
    if not target_url:
        return jsonify({"error": "url parameter required"}), 400

    # 안전 체크: naver.com 도메인만 프록시 허용
    if "naver.com" not in target_url:
        return jsonify({"error": "Only naver.com URLs are allowed"}), 403

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Referer": "https://m.stock.naver.com/",
            "Accept": "application/json, text/plain, */*",
        }
        resp = req_lib.get(target_url, headers=headers, timeout=10)
        resp.raise_for_status()
        return jsonify(resp.json())
    except Exception as e:
        logger.error(f"Proxy JSON error: {e}")
        return jsonify({"error": str(e), "url": target_url}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    logger.info(f"Kiwoom Crawler Proxy 시작: http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
