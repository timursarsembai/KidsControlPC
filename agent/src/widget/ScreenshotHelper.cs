using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace KidsControl
{
    public class ScreenshotHelper
    {
        static ImageCodecInfo GetJpegCodec()
        {
            return ImageCodecInfo.GetImageEncoders().FirstOrDefault(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
        }

        static void SaveJpeg(Bitmap bitmap, string outputPath, long quality)
        {
            ImageCodecInfo codec = GetJpegCodec();
            if (codec == null)
            {
                bitmap.Save(outputPath, ImageFormat.Jpeg);
                return;
            }

            using (EncoderParameters parameters = new EncoderParameters(1))
            {
                parameters.Param[0] = new EncoderParameter(Encoder.Quality, quality);
                bitmap.Save(outputPath, codec, parameters);
            }
        }

        static Bitmap ResizeIfNeeded(Bitmap source, int maxWidth)
        {
            if (maxWidth <= 0 || source.Width <= maxWidth) return source;

            int targetWidth = maxWidth;
            int targetHeight = (int)Math.Round(source.Height * (targetWidth / (double)source.Width));
            Bitmap resized = new Bitmap(targetWidth, targetHeight);
            using (Graphics graphics = Graphics.FromImage(resized))
            {
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.SmoothingMode = SmoothingMode.HighQuality;
                graphics.DrawImage(source, 0, 0, targetWidth, targetHeight);
            }
            source.Dispose();
            return resized;
        }

        [STAThread]
        static int Main(string[] args)
        {
            try
            {
                if (args.Length < 1) return 2;

                string outputPath = args[0];
                int parsedMaxWidth;
                long parsedQuality;
                int maxWidth = args.Length >= 2 && int.TryParse(args[1], out parsedMaxWidth) ? parsedMaxWidth : 1280;
                long quality = args.Length >= 3 && long.TryParse(args[2], out parsedQuality) ? parsedQuality : 70;
                quality = Math.Max(20, Math.Min(95, quality));

                Rectangle bounds = SystemInformation.VirtualScreen;
                if (bounds.Width <= 0 || bounds.Height <= 0) return 3;

                Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
                using (Bitmap screenshot = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
                {
                    using (Graphics graphics = Graphics.FromImage(screenshot))
                    {
                        graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                    }

                    using (Bitmap output = ResizeIfNeeded(screenshot, maxWidth))
                    {
                        SaveJpeg(output, outputPath, quality);
                    }
                }

                return File.Exists(outputPath) ? 0 : 4;
            }
            catch (Exception ex)
            {
                try
                {
                    if (args.Length > 0)
                    {
                        File.WriteAllText(args[0] + ".error.txt", ex.Message);
                    }
                }
                catch { }
                return 1;
            }
        }
    }
}
