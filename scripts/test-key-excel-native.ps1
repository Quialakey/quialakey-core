$ErrorActionPreference = 'Stop'
$workbookPath = Join-Path $PSScriptRoot '../output/export-signatures-test/T3-5-export.xlsx'
$workbookPath = (Resolve-Path -LiteralPath $workbookPath).Path
$excel = New-Object -ComObject Excel.Application
$book = $null
try {
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AutomationSecurity = 3
    $book = $excel.Workbooks.Open($workbookPath, 0, $true)
    $sheet = $book.Worksheets.Item(1)
    if ($sheet.Shapes.Count -ne 3) { throw 'Missing signatures.' }
    $index = 0
    foreach ($shape in $sheet.Shapes) {
        $cell = $shape.TopLeftCell
        if ($cell.Row -ne (3 + $index) -or $cell.Column -ne 18) {
            throw 'Signature attached to the wrong movement.'
        }
        if ($shape.Top -lt $cell.Top -or
            ($shape.Top + $shape.Height) -gt ($cell.Top + $cell.Height + 0.5) -or
            $shape.Left -lt $cell.Left -or
            ($shape.Left + $shape.Width) -gt ($cell.Left + $cell.Width + 0.5)) {
            throw 'Signature extends outside its cell.'
        }
        $index++
    }
    Write-Output "Excel $($excel.Version): all 3 signatures fit their movement cells."
} finally {
    if ($book) { $book.Close($false) }
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
