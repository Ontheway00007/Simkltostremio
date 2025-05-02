name: Simkl List Scraper

on:
  workflow_dispatch:
    inputs:
      url:
        description: 'Simkl list URL to scrape'
        required: true
      cookies:
        description: 'Cookies for authentication (optional)'
        required: false
      output_name:
        description: 'Name for the output file'
        required: true
        default: 'simkl-imdb-list'

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        
      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm install cheerio
        
      - name: Run scraper
        run: node scripts/scraper.js "${{ github.event.inputs.url }}" "${{ github.event.inputs.cookies }}" "${{ github.event.inputs.output_name }}"
        
      - name: Upload results as artifact
        uses: actions/upload-artifact@v2  # Changed from v3 to v2
        with:
          name: ${{ github.event.inputs.output_name }}
          path: results/${{ github.event.inputs.output_name }}.csv
          
      - name: Commit results to repository
        run: |
          mkdir -p results
          git config --global user.name 'GitHub Actions'
          git config --global user.email 'actions@github.com'
          git add results/${{ github.event.inputs.output_name }}.csv || echo "No changes to commit"
          git commit -m "Add scraping results for ${{ github.event.inputs.output_name }}" || echo "No changes to commit"
          git push || echo "No changes to push"
        continue-on-error: true
