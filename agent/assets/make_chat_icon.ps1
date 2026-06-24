# Generates chat.ico (a purple speech-bubble with three dots) used as the
# ChatTrayApp / shortcut icon. Run once: powershell -File make_chat_icon.ps1
# Produces a classic DIB (BGRA) ICO so old csc and Explorer both accept it.
Add-Type -AssemblyName System.Drawing

$outIco = Join-Path $PSScriptRoot 'chat.ico'

function New-ChatBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = [double]$size
    $accent = [System.Drawing.Color]::FromArgb(255, 99, 102, 241)
    $brush = New-Object System.Drawing.SolidBrush($accent)
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

    $pad = $s * 0.10
    $w = $s - 2 * $pad
    $h = $s * 0.60
    $r = $s * 0.18
    $x = $pad
    $y = $pad
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)

    $tail = New-Object 'System.Drawing.PointF[]' 3
    $tail[0] = New-Object System.Drawing.PointF([single]($x + $w * 0.22), [single]($y + $h - 1))
    $tail[1] = New-Object System.Drawing.PointF([single]($x + $w * 0.16), [single]($y + $h + $s * 0.22))
    $tail[2] = New-Object System.Drawing.PointF([single]($x + $w * 0.50), [single]($y + $h - 1))
    $g.FillPolygon($brush, $tail)

    $dotR = $s * 0.072
    $cy = $y + $h * 0.5 - $dotR
    $gap = $w * 0.24
    $cx0 = $x + $w * 0.5 - $gap - $dotR
    for ($i = 0; $i -lt 3; $i++) {
        $cx = $cx0 + $i * $gap
        $g.FillEllipse($white, [single]$cx, [single]$cy, [single]($dotR * 2), [single]($dotR * 2))
    }
    $g.Dispose()
    return $bmp
}

function Get-DibBytes($bmp, [int]$size) {
    # XOR (BGRA, bottom-up) + AND mask (all zero; alpha drives transparency)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $buf = New-Object Byte[] ($stride * $size)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
    $bmp.UnlockBits($data)

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    # BITMAPINFOHEADER
    $bw.Write([UInt32]40)
    $bw.Write([Int32]$size)
    $bw.Write([Int32]($size * 2))
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]0)
    $bw.Write([UInt32]0)
    $bw.Write([Int32]0); $bw.Write([Int32]0)
    $bw.Write([UInt32]0); $bw.Write([UInt32]0)
    # XOR pixels, bottom-up
    for ($row = $size - 1; $row -ge 0; $row--) {
        $bw.Write($buf, $row * $stride, $size * 4)
    }
    # AND mask (zeroed), rows padded to 4 bytes
    $maskRow = [int][Math]::Floor((($size + 31) / 32)) * 4
    $zero = New-Object Byte[] ($maskRow * $size)
    $bw.Write($zero, 0, $zero.Length)
    $bw.Flush()
    $bytes = $ms.ToArray()
    $bw.Close(); $ms.Dispose()
    return ,$bytes
}

$sizes = @(16, 32, 48, 64, 128, 256)
$dibs = @()
foreach ($sz in $sizes) {
    $bmp = New-ChatBitmap $sz
    $dibs += ,(Get-DibBytes $bmp $sz)
    $bmp.Dispose()
}

$fs = New-Object System.IO.FileStream($outIco, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $sz = $sizes[$i]
    $data = $dibs[$i]
    $bw.Write([Byte]($(if ($sz -ge 256) { 0 } else { $sz })))
    $bw.Write([Byte]($(if ($sz -ge 256) { 0 } else { $sz })))
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$data.Length)
    $bw.Write([UInt32]$offset)
    $offset += $data.Length
}
foreach ($data in $dibs) { $bw.Write($data) }
$bw.Flush(); $bw.Close(); $fs.Close()
Write-Output "Created $outIco"
