export function StewardsView() {
  return (
    <div className="h-full w-full">
      <iframe
        src="https://stewards-console.pages.dev/"
        className="w-full h-full border-0"
        title="Stewards Console"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      />
    </div>
  )
}
