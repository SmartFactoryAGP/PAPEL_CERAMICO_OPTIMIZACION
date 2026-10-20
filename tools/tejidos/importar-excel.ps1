# Carga posiciones y tamaños del rack de Tejidos desde el Excel TEJIDOS.xlsx
# (hojas "tamaño" y "Rack"). Necesita Excel instalado; lo abre oculto y en
# solo lectura. Uso, desde la carpeta del proyecto:
#   powershell -ExecutionPolicy Bypass -File tools\tejidos\importar-excel.ps1 C:\ruta\TEJIDOS.xlsx
param([Parameter(Mandatory=$true)][string]$Excel)
$ErrorActionPreference = 'Stop'
$archivo = (Resolve-Path $Excel).Path
$json = Join-Path $env:TEMP ("tejidos-excel-" + [guid]::NewGuid().ToString('N') + ".json")
$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $false; $xl.DisplayAlerts = $false
  $wb = $xl.Workbooks.Open($archivo, 0, $true)
  function Leer($nombre){
    $ws = $wb.Worksheets.Item($nombre); $r = $ws.UsedRange; $v = $r.Value2; $filas = @()
    for($i = 2; $i -le $r.Rows.Count; $i++){ $f = @(); for($j = 1; $j -le $r.Columns.Count; $j++){ $f += ,("" + $v[$i, $j]) }; $filas += ,$f }
    ,$filas
  }
  # "tama" + ñ: escrita con su código para que funcione aunque PowerShell lea este archivo sin UTF-8
  @{ tamano = (Leer ("tama" + [char]0xF1 + "o")); rack = (Leer 'Rack') } | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $json -Encoding utf8
  $wb.Close($false)
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
try { node (Join-Path $PSScriptRoot 'importar.js') $json } finally { Remove-Item $json -ErrorAction SilentlyContinue }
