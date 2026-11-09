package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"time"
)

// The weather where the keyboard is, from Open-Meteo (no key needed), for
// the farm's sky. kbscreen's config names the place:
//
//	[weather]
//	lat = 56.182
//	lon = 15.590

const openMeteo = "https://api.open-meteo.com/v1/forecast"

type Weather struct {
	Sky             string  // clear, cloud, fog, rain, snow, storm
	Code            int     // the WMO weather code it came from
	Temp            float64 // °C
	Wind            float64 // km/h
	Day             bool    // between sunrise and sunset
	Sunrise, Sunset string  // 07:22
}

// skyOf groups WMO weather codes into what the farm draws.
func skyOf(code int) string {
	switch {
	case code <= 1:
		return "clear"
	case code <= 3:
		return "cloud"
	case code == 45 || code == 48:
		return "fog"
	case code >= 71 && code <= 77, code == 85 || code == 86:
		return "snow"
	case code >= 95:
		return "storm"
	case code >= 51 && code <= 82:
		return "rain"
	}
	return "cloud"
}

func fetchWeather(ctx context.Context, c *http.Client, base string, lat, lon float64) (Weather, error) {
	q := url.Values{
		"latitude":      {strconv.FormatFloat(lat, 'f', 3, 64)},
		"longitude":     {strconv.FormatFloat(lon, 'f', 3, 64)},
		"current":       {"temperature_2m,weather_code,is_day,wind_speed_10m"},
		"daily":         {"sunrise,sunset"},
		"timezone":      {"auto"},
		"forecast_days": {"1"},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+q.Encode(), nil)
	resp, err := c.Do(req)
	if err != nil {
		return Weather{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Weather{}, fmt.Errorf("weather: %s", resp.Status)
	}
	var r struct {
		Current struct {
			Temp  float64 `json:"temperature_2m"`
			Code  int     `json:"weather_code"`
			IsDay int     `json:"is_day"`
			Wind  float64 `json:"wind_speed_10m"`
		} `json:"current"`
		Daily struct {
			Sunrise []string `json:"sunrise"`
			Sunset  []string `json:"sunset"`
		} `json:"daily"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return Weather{}, fmt.Errorf("weather: %w", err)
	}
	clock := func(s []string) string { // 2026-11-09T07:22 -> 07:22
		if len(s) == 0 || len(s[0]) < 16 {
			return ""
		}
		return s[0][11:16]
	}
	cur := r.Current
	return Weather{Sky: skyOf(cur.Code), Code: cur.Code, Temp: cur.Temp, Wind: cur.Wind, Day: cur.IsDay == 1,
		Sunrise: clock(r.Daily.Sunrise), Sunset: clock(r.Daily.Sunset)}, nil
}

var tomlNumberLine = regexp.MustCompile(`(?m)^\s*([\w-]+)\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)\s*(?:#.*)?$`)

func tomlNumber(cfg []byte, key string) (float64, bool) {
	for _, m := range tomlNumberLine.FindAllSubmatch(cfg, -1) {
		if string(m[1]) == key {
			v, err := strconv.ParseFloat(string(m[2]), 64)
			return v, err == nil
		}
	}
	return 0, false
}

// weatherPlace reads lat and lon from the config; ok is false without both.
func weatherPlace(path string) (lat, lon float64, ok bool) {
	cfg, err := os.ReadFile(path)
	if err != nil {
		return 0, 0, false
	}
	lat, okLat := tomlNumber(cfg, "lat")
	lon, okLon := tomlNumber(cfg, "lon")
	return lat, lon, okLat && okLon
}

// pollWeather asks every 15 minutes, every 2 after a failure; the last good
// answer stays until a new one comes.
func pollWeather(ctx context.Context, st *state, lat, lon float64) {
	c := &http.Client{Timeout: 10 * time.Second}
	var lastErr string
	for ctx.Err() == nil {
		w, err := fetchWeather(ctx, c, openMeteo, lat, lon)
		wait := 15 * time.Minute
		if err != nil {
			if err.Error() != lastErr {
				log.Printf("weather: %v", err)
				lastErr = err.Error()
			}
			wait = 2 * time.Minute
		} else {
			lastErr = ""
			st.update(func(st *state) { st.weather = &w })
		}
		sleep(ctx, wait)
	}
}
