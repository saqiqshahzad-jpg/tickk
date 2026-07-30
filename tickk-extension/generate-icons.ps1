Add-Type -AssemblyName System.Drawing

function New-TickkIcon {
    param([int]$Size, [string]$OutputPath)
    
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::FromArgb(16, 185, 129))
    
    $fontSize = [Math]::Max(8, [int]($Size * 0.45))
    $font = New-Object System.Drawing.Font('Arial', $fontSize, [System.Drawing.FontStyle]::Bold)
    $brush = [System.Drawing.Brushes]::White
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
    
    $g.DrawString('t', $font, $brush, $rect, $sf)
    
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    $font.Dispose()
    $sf.Dispose()
    
    Write-Host "Created: $OutputPath ($Size x $Size)"
}

New-TickkIcon -Size 16 -OutputPath "icons\icon16.png"
New-TickkIcon -Size 48 -OutputPath "icons\icon48.png"
New-TickkIcon -Size 128 -OutputPath "icons\icon128.png"

Write-Host "All icons generated successfully!"
