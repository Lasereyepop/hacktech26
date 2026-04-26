import asyncio
from playwright.async_api import async_playwright
from pathlib import Path
from site_list import websites
import sys

async def run():
    save_dir = Path("data/input/websites")
    save_dir.mkdir(parents=True, exist_ok=True)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1470, "height": 956})
        
        for url in websites:
            try:
                name = url.split("//")[-1].replace("www.", "").replace(".", "_").strip("_")
                save_path = save_dir / f"{name}.png"
                
                print(f"Scraping {url}...")
                page = await context.new_page()
                await page.goto(url, timeout=30000)
                await page.screenshot(path=str(save_path), full_page=False)
                await page.close()
                
            except Exception as e:
                print(f"Failed to scrape {url}: {e}")
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
