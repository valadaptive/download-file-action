A GitHub Action for downloading (and caching) files.

Options:

- `url`: The URL to fetch. Required.
- `destination`: The path to save the file to. Will be [default directory]/[URL
    file name] if not provided.
- `headers`: The headers to send with the request, in standard HTTP headers
  format (colons to separate name and value, separated by newlines).
- `additional-cache-key`: Additional key to match against when caching the file.
- `max-age`: The maximum age of the cached file in seconds. If omitted or the
            empty string, the file will be cached indefinitely. If set to 0, the
            file will always be re-downloaded.
