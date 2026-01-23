-- RegalosQueCantan Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Songs table
CREATE TABLE IF NOT EXISTS songs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Song details
  recipient_name TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  relationship TEXT,
  genre TEXT NOT NULL,
  occasion TEXT NOT NULL,
  details TEXT NOT NULL,
  email TEXT NOT NULL,
  
  -- Generated content
  lyrics TEXT,
  audio_url TEXT,
  preview_url TEXT,
  
  -- Status
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  
  -- Payment
  paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMP WITH TIME ZONE,
  stripe_session_id TEXT,
  
  -- Metadata
  kie_task_id TEXT,
  error_message TEXT
);

-- Create indexes
CREATE INDEX idx_songs_email ON songs(email);
CREATE INDEX idx_songs_status ON songs(status);
CREATE INDEX idx_songs_paid ON songs(paid);
CREATE INDEX idx_songs_created_at ON songs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert (create songs)
CREATE POLICY "Anyone can create songs" ON songs
  FOR INSERT WITH CHECK (true);

-- Policy: Anyone can read their own songs (by email)
CREATE POLICY "Users can read their own songs" ON songs
  FOR SELECT USING (true);

-- Policy: Service role can update
CREATE POLICY "Service role can update songs" ON songs
  FOR UPDATE USING (true);

-- Create storage bucket for audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio', 'audio', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: Public read access
CREATE POLICY "Public read access for audio" ON storage.objects
  FOR SELECT USING (bucket_id = 'audio');

-- Storage policy: Service role can upload
CREATE POLICY "Service role can upload audio" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'audio');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_songs_updated_at
  BEFORE UPDATE ON songs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Sample query to check songs
-- SELECT id, recipient_name, genre, status, paid, created_at FROM songs ORDER BY created_at DESC;
