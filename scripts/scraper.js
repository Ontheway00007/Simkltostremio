const cheerio = require("cheerio")
const fs = require("fs")
const path = require("path")
const https = require("https")

// Get command line arguments
const url = process.argv[2]
const cookies = process.argv[3] || ""
const outputName = process.argv[4] || "simkl-imdb-list"

// Ensure results directory exists
const resultsDir = path.join(__dirname, "..", "results")
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true })
}

// Browser-like headers to avoid being blocked
const getBrowserHeaders = (referer) => {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  }

  if (referer) {
    headers["Referer"] = referer
  }

  if (cookies) {
    headers["Cookie"] = cookies
  }

  return headers
}

// Helper function to fetch URLs with proper error handling
async function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: headers,
    }

    const req = https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed with status code ${res.statusCode}`))
        return
      }

      let data = ""
      res.on("data", (chunk) => {
        data += chunk
      })

      res.on("end", () => {
        resolve(data)
      })
    })

    req.on("error", (err) => {
      reject(err)
    })

    req.end()
  })
}

// Main scraping function
async function scrapeSimklList() {
  console.log(`Starting to scrape: ${url}`)

  try {
    // Step 1: Get the initial page and analyze pagination
    console.log("Analyzing list...")
    const html = await fetchUrl(url, getBrowserHeaders())
    const $ = cheerio.load(html)

    // Extract total items count
    const totalItemsText = $("#progressPage").attr("data-total")
    const totalItems = totalItemsText ? Number.parseInt(totalItemsText, 10) : 0

    // Calculate total pages (100 items per page)
    const totalPages = Math.ceil(totalItems / 100) || 1
    console.log(`Found ${totalItems} items across ${totalPages} pages`)

    // Step 2: Extract all movie/show links from all pages
    const allLinks = []

    // Process first page
    $('a[href^="/movies/"], a[href^="/shows/"]').each((_, element) => {
      const href = $(element).attr("href")
      if (href && !allLinks.includes(href) && (href.includes("/movies/") || href.includes("/shows/"))) {
        allLinks.push(href)
      }
    })

    console.log(`Extracted ${allLinks.length} links from page 1`)

    // Process remaining pages
    if (totalPages > 1) {
      const baseUrl = new URL(url)
      const pageUrl = `${baseUrl.origin}${baseUrl.pathname}${baseUrl.search ? baseUrl.search : ""}`

      for (let page = 2; page <= totalPages; page++) {
        try {
          console.log(`Fetching page ${page}/${totalPages}...`)
          const pageHtml = await fetchUrl(`${pageUrl}?page=${page}`, getBrowserHeaders(url))
          const page$ = cheerio.load(pageHtml)

          const pageLinks = []
          page$('a[href^="/movies/"], a[href^="/shows/"]').each((_, element) => {
            const href = page$(element).attr("href")
            if (href && !allLinks.includes(href) && (href.includes("/movies/") || href.includes("/shows/"))) {
              pageLinks.push(href)
              allLinks.push(href)
            }
          })

          console.log(`Extracted ${pageLinks.length} links from page ${page}`)

          // Add a small delay to avoid overwhelming the server
          await new Promise((resolve) => setTimeout(resolve, 500))
        } catch (error) {
          console.error(`Error fetching page ${page}: ${error.message}`)
        }
      }
    }

    // Step 3: Get IMDB URLs for each item
    const uniqueLinks = [...new Set(allLinks)]
    console.log(`Found ${uniqueLinks.length} unique items. Fetching IMDB links...`)

    const results = []
    const batchSize = 10
    const batches = Math.ceil(uniqueLinks.length / batchSize)

    for (let i = 0; i < uniqueLinks.length; i += batchSize) {
      const batch = uniqueLinks.slice(i, i + batchSize)
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${batches} (${batch.length} links)...`)

      const batchPromises = batch.map(async (link) => {
        try {
          const fullUrl = `https://simkl.com${link}`
          const itemHtml = await fetchUrl(fullUrl, getBrowserHeaders("https://simkl.com/"))
          const item$ = cheerio.load(itemHtml)

          // Extract title
          const title = item$("h1.titles").text().trim() || link.split("/").pop() || "Unknown"

          // Find IMDB link
          let imdbUrl = "Not found"
          item$('a[href*="imdb.com/title/"]').each((_, element) => {
            const href = item$(element).attr("href")
            if (href && href.includes("imdb.com/title/")) {
              imdbUrl = href
            }
          })

          return {
            title,
            simklUrl: fullUrl,
            imdbUrl,
          }
        } catch (error) {
          console.error(`Error processing ${link}: ${error.message}`)
          return {
            title: link.split("/").pop() || "Unknown",
            simklUrl: `https://simkl.com${link}`,
            imdbUrl: "Error fetching",
          }
        }
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
      console.log(`Processed ${results.length}/${uniqueLinks.length} items`)

      // Add a small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    // Step 4: Save results to CSV
    const csvContent = [
      ["Title", "Simkl URL", "IMDB URL"],
      ...results.map((item) => [`"${item.title.replace(/"/g, '""')}"`, item.simklUrl, item.imdbUrl]),
    ]
      .map((row) => row.join(","))
      .join("\n")

    const outputPath = path.join(resultsDir, `${outputName}.csv`)
    fs.writeFileSync(outputPath, csvContent)
    console.log(`Scraping completed! Results saved to ${outputPath}`)
    console.log(`Total items scraped: ${results.length}`)

    // Also save as JSON for easier processing
    const jsonOutputPath = path.join(resultsDir, `${outputName}.json`)
    fs.writeFileSync(jsonOutputPath, JSON.stringify(results, null, 2))

    return {
      success: true,
      itemsScraped: results.length,
      outputPath,
    }
  } catch (error) {
    console.error(`Scraping failed: ${error.message}`)
    return {
      success: false,
      error: error.message,
    }
  }
}

// Run the scraper
scrapeSimklList()

