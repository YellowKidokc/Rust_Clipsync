export function CrawlersView() {
  return (
    <div className="h-full w-full">
      <iframe
        src="https://smart-crawler.davidokc28.workers.dev/"
        className="w-full h-full border-0"
        title="Smart Crawler"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  )
}
