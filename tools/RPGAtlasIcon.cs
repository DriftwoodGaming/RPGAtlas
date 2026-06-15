/* RPGAtlas icon generator. GPL-3.0-or-later (see LICENSE).

   Renders img/system/rpgatlas-logo.svg (compass-and-globe) with GDI+ at several
   resolutions and packs them into a multi-size Windows .ico, written to the path
   given as the first argument. Keeps the launcher build free of any external
   SVG/ICO converter: it draws the same shapes the SVG defines, in 64-unit space,
   scaled to each icon size. Re-run this if the logo changes. */
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

internal static class RPGAtlasIcon
{
    private static readonly int[] Sizes = { 16, 32, 48, 256 };

    private static readonly Color Ink = Color.FromArgb(20, 35, 57);      // #142339
    private static readonly Color GoldTop = Color.FromArgb(255, 226, 160); // #ffe2a0
    private static readonly Color GoldBottom = Color.FromArgb(217, 161, 63); // #d9a13f
    private static readonly Color SeaInner = Color.FromArgb(46, 88, 135);  // #2e5887
    private static readonly Color SeaOuter = Color.FromArgb(20, 35, 57);   // #142339

    private static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("Usage: RPGAtlasIcon <output.ico>");
            return 1;
        }

        byte[][] pngs = new byte[Sizes.Length][];
        for (int i = 0; i < Sizes.Length; i++)
            pngs[i] = RenderPng(Sizes[i]);

        WriteIco(args[0], pngs);
        Console.WriteLine("Wrote " + args[0]);
        return 0;
    }

    private static byte[] RenderPng(int size)
    {
        using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                g.ScaleTransform(size / 64f, size / 64f); // draw everything in 64-unit space
                DrawLogo(g);
            }
            using (MemoryStream ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }
        }
    }

    private static void DrawLogo(Graphics g)
    {
        // Sea (radial gradient) clipped to the globe disc.
        using (GraphicsPath disc = new GraphicsPath())
        {
            disc.AddEllipse(4f, 4f, 56f, 56f);
            GraphicsState saved = g.Save();
            g.SetClip(disc);
            using (GraphicsPath seaPath = new GraphicsPath())
            {
                seaPath.AddEllipse(32f - 41.6f, 25.6f - 41.6f, 83.2f, 83.2f);
                using (PathGradientBrush sea = new PathGradientBrush(seaPath))
                {
                    sea.CenterPoint = new PointF(32f, 25.6f);
                    sea.CenterColor = SeaInner;
                    sea.SurroundColors = new[] { SeaOuter };
                    g.FillPath(sea, seaPath);
                }
            }
            g.Restore(saved);
        }

        // Graticule lines (faint blue), kept inside the disc.
        using (GraphicsPath disc = new GraphicsPath())
        {
            disc.AddEllipse(4f, 4f, 56f, 56f);
            GraphicsState saved = g.Save();
            g.SetClip(disc);
            using (Pen grid = new Pen(Color.FromArgb(115, 143, 180, 224), 1f))
            {
                g.DrawEllipse(grid, 32f - 11f, 32f - 26f, 22f, 52f);
                g.DrawEllipse(grid, 32f - 21f, 32f - 26f, 42f, 52f);
                g.DrawLine(grid, 6.5f, 32f, 57.5f, 32f);
                g.DrawLine(grid, 10f, 20f, 54f, 20f);
                g.DrawLine(grid, 10f, 44f, 54f, 44f);
            }
            g.Restore(saved);
        }

        // Pixel landmasses.
        using (SolidBrush land = new SolidBrush(Color.FromArgb(217, 127, 176, 105)))
        {
            g.FillRectangle(land, 17f, 21f, 5f, 5f);
            g.FillRectangle(land, 22f, 18f, 5f, 5f);
            g.FillRectangle(land, 22f, 23f, 4f, 4f);
            g.FillRectangle(land, 39f, 37f, 5f, 5f);
            g.FillRectangle(land, 42f, 33f, 4f, 4f);
        }

        // Gold rim of the globe (drawn over the sea edge).
        RectangleF goldRect = new RectangleF(4f, 4f, 56f, 56f);
        using (LinearGradientBrush gold = new LinearGradientBrush(goldRect, GoldTop, GoldBottom, LinearGradientMode.Vertical))
        using (Pen rim = new Pen(gold, 3f))
            g.DrawEllipse(rim, goldRect);

        // Compass rose: diagonal star.
        PointF[] star =
        {
            P(38,32), P(44,44), P(32,38), P(20,44), P(26,32), P(20,20), P(32,26), P(44,20)
        };
        using (SolidBrush cream = new SolidBrush(Color.FromArgb(232, 217, 176)))
        using (Pen edge = new Pen(Ink, 0.8f) { LineJoin = LineJoin.Round })
        {
            g.FillPolygon(cream, star);
            g.DrawPolygon(edge, star);
        }

        // Cardinal needle, two-tone.
        using (LinearGradientBrush gold = new LinearGradientBrush(goldRect, GoldTop, GoldBottom, LinearGradientMode.Vertical))
        using (SolidBrush shade = new SolidBrush(Color.FromArgb(168, 118, 42))) // #a8762a
        using (Pen edge = new Pen(Ink, 0.8f) { LineJoin = LineJoin.Round })
        {
            Triangle(g, gold, edge, P(32, 5), P(36.4f, 27.6f), P(32, 32));
            Triangle(g, gold, edge, P(59, 32), P(36.4f, 36.4f), P(32, 32));
            Triangle(g, gold, edge, P(32, 59), P(27.6f, 36.4f), P(32, 32));
            Triangle(g, gold, edge, P(5, 32), P(27.6f, 27.6f), P(32, 32));

            Triangle(g, shade, edge, P(32, 5), P(27.6f, 27.6f), P(32, 32));
            Triangle(g, shade, edge, P(59, 32), P(36.4f, 27.6f), P(32, 32));
            Triangle(g, shade, edge, P(32, 59), P(36.4f, 36.4f), P(32, 32));
            Triangle(g, shade, edge, P(5, 32), P(27.6f, 36.4f), P(32, 32));
        }

        // Hub.
        using (LinearGradientBrush gold = new LinearGradientBrush(goldRect, GoldTop, GoldBottom, LinearGradientMode.Vertical))
        using (Pen edge = new Pen(Ink, 1f))
        {
            g.FillEllipse(gold, 32f - 3.6f, 32f - 3.6f, 7.2f, 7.2f);
            g.DrawEllipse(edge, 32f - 3.6f, 32f - 3.6f, 7.2f, 7.2f);
        }
    }

    private static PointF P(float x, float y) { return new PointF(x, y); }

    private static void Triangle(Graphics g, Brush fill, Pen edge, PointF a, PointF b, PointF c)
    {
        PointF[] tri = { a, b, c };
        g.FillPolygon(fill, tri);
        g.DrawPolygon(edge, tri);
    }

    private static void WriteIco(string path, byte[][] images)
    {
        using (FileStream fs = File.Create(path))
        using (BinaryWriter w = new BinaryWriter(fs))
        {
            w.Write((short)0);              // reserved
            w.Write((short)1);              // type: icon
            w.Write((short)images.Length);  // image count

            int offset = 6 + 16 * images.Length;
            for (int i = 0; i < images.Length; i++)
            {
                int dim = Sizes[i];
                w.Write((byte)(dim >= 256 ? 0 : dim)); // width  (0 => 256)
                w.Write((byte)(dim >= 256 ? 0 : dim)); // height (0 => 256)
                w.Write((byte)0);   // palette
                w.Write((byte)0);   // reserved
                w.Write((short)1);  // colour planes
                w.Write((short)32); // bits per pixel
                w.Write(images[i].Length);
                w.Write(offset);
                offset += images[i].Length;
            }
            foreach (byte[] image in images)
                w.Write(image);
        }
    }
}
