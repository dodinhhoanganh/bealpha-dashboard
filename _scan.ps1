Get-ChildItem -Recurse -Include '*.tsx','*.ts' -Path 'app','components' |
  Where-Object { $_.Length -gt 10000 } |
  ForEach-Object {
    $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
    $kb = [math]::Round($_.Length / 1024, 1)
    [PSCustomObject]@{ Lines = $lines; KB = $kb; File = $_.FullName.Replace('E:\bealpha\bealpha-dashboard\','') }
  } |
  Sort-Object Lines -Descending |
  Format-Table -AutoSize
