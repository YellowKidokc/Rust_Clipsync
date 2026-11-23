export function DeepResearchView() {
  return (
    <div className="h-full w-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="text-xl font-bold">Deep Research</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your deep research tool URL below or use the default placeholder
        </p>
      </div>
      <div className="flex-1">
        <iframe
          src="about:blank"
          className="w-full h-full border-0"
          title="Deep Research"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </div>
    </div>
  )
}
